const { Project, User, Job, ProjectManager, Engineer } = require("../models");
const { Op } = require("sequelize");
const { createNotification } = require("../utils/notificationUtil");

// Get all projects with filtering and pagination - list
const getProjects = async (req, res) => {
  try {
    const { page, limit, status, priority } = req.query;
    const { user_id, role } = req.user; 

    let where = {};
    let include = [];

    if (role === "project_manager") {
      // 🔧 FIX: filter via ProjectManager.user_id
      include.push({
        model: ProjectManager,
        as: "project_manager",
        where: { user_id },
        attributes: [],
        required: true,
      });
    }

    if (role === "engineer") {
      // 🔧 Engineers only see projects they are assigned to
      include.push({
        model: Engineer,
        as: "engineers",
        required: true,
        include: [
          {
            model: User,
            as: "user",
            where: { user_id },
            attributes: [],
          },
        ],
      });
    }

    // Admin → no restriction

    if (status) {
      where.status = status;
    }

    if (priority) {
      where.priority = priority;
    }

    const pagination = {};
    if (page && limit) {
      pagination.limit = parseInt(limit);
      pagination.offset = (parseInt(page) - 1) * parseInt(limit);
    }

    const projects = await Project.findAndCountAll({
      where,
      include: [
        ...include,

        {
          model: Engineer,
          as: "engineers",
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: ["first_name", "last_name", "email"],
            },
          ],
          through: { attributes: [] },
        },

        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: ["first_name", "last_name", "email"],
            },
          ],
        },
      ],
      order: [["created_at", "DESC"]],
      distinct: true,
      ...pagination,
    });

    return res.json({
      success: true,
      data: {
        projects: projects.rows,
        pagination:
          page && limit
            ? {
                currentPage: parseInt(page),
                totalPages: Math.ceil(projects.count / parseInt(limit)),
                totalItems: projects.count,
                itemsPerPage: parseInt(limit),
              }
            : undefined,
      },
    });
  } catch (error) {
    console.error("Failed to get projects:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get projects",
      error: error.message,
    });
  }
};

// Get project by ID
const getProjectById = async (req, res) => {
  try {
    const { projects_id } = req.params;

    const project = await Project.findOne({
      where: { projects_id },

      include: [
        // 🔹 Project Manager
        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: ["first_name", "last_name", "email", "phone_number"],
            },
          ],
        },

        // 🔹 Engineers (Many-to-Many)
        {
          model: Engineer,
          as: "engineers",
          through: { attributes: [] },
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: [
                "first_name",
                "last_name",
                "email",
                "phone_number",
              ],
            },
          ],
        },
      ],
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    return res.json({
      success: true,
      data: project,
    });
  } catch (error) {
    console.error("Failed to get project details:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get project details",
      error: error.message,
    });
  }
};

// Create new project
const createProject = async (req, res) => {
  try {
    const {
      title,
      description,
      engineer_ids = [], // 🔧 array of Engineer IDs (optional)
      status = "planning",
      priority = "medium",
      progress = 0,
      team = [],
      tasks = [],
      start_date,
      deadline,
      feedback,
    } = req.body;

    /* ===============================
       VERIFY PROJECT MANAGER
       =============================== */
    const manager = await ProjectManager.findOne({
      where: { user_id: req.user.user_id },
    });

    if (!manager) {
      return res.status(403).json({
        success: false,
        message: "Only project managers can create projects",
      });
    }

    /* ===============================
       CREATE PROJECT
       =============================== */
    const project = await Project.create({
      project_managers_id: manager.project_managers_id, // ✅ correct
      title,
      description,
      status,
      priority,
      progress,
      team,
      tasks,
      start_date,
      deadline,
      feedback,
    });

    /* ===============================
       ASSIGN ENGINEERS (OPTIONAL)
       =============================== */
    if (Array.isArray(engineer_ids) && engineer_ids.length > 0) {
      const engineers = await Engineer.findAll({
        where: { engineer_id: engineer_ids },
      });

      if (engineers.length) {
        await project.addEngineers(engineers); // Sequelize M:N helper
      }
    }

    return res.status(201).json({
      success: true,
      message: "Project created successfully",
      data: project,
    });
  } catch (error) {
    console.error("Project creation failed:", error);

    return res.status(500).json({
      success: false,
      message: "Project creation failed",
      error: error.message,
    });
  }
};

// Update project
const updateProject = async (req, res) => {
  try {
    const { projects_id } = req.params;
    const updates = req.body;

    const project = await Project.findOne({
      where: { projects_id },
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          include: [{ model: User, as: "user" }],
        },
        {
          model: Engineer,
          as: "engineers",
          through: { attributes: [] },
          include: [{ model: User, as: "user" }],
        },
      ],
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    /* ===============================
   PERMISSION CHECK
   =============================== */
    if (req.user.role === "project_manager") {
      const projectManagerUserId = project.project_manager?.user?.user_id;

      // ❌ Block only if project is assigned AND not owned by this PM
      if (projectManagerUserId && projectManagerUserId !== req.user.user_id) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to update this project",
        });
      }
    }

    const oldStatus = project.status;
    const oldProgress = project.progress;

    await project.update(updates);

    /* ===============================
       NOTIFICATIONS (ENGINEERS)
       =============================== */
    const engineerUsers =
      project.engineers?.map((e) => e.user?.user_id).filter(Boolean) || [];

    for (const userId of engineerUsers) {
      // Status change
      if (updates.status && oldStatus !== updates.status) {
        await createNotification({
          user_id: userId,
          title: "Project Status Updated",
          message: `Project "${project.title}" status changed to ${updates.status}`,
          type: "info",
          action_url: `/projects/${projects_id}`,
          metadata: {
            project_id: projects_id,
            old_status: oldStatus,
            new_status: updates.status,
          },
        });
      }

      // Milestone notification
      if (
        typeof updates.progress === "number" &&
        updates.progress !== oldProgress &&
        updates.progress % 25 === 0
      ) {
        await createNotification({
          user_id: userId,
          title: "Project Milestone",
          message: `Project "${project.title}" is now ${updates.progress}% complete`,
          type: "success",
          action_url: `/projects/${projects_id}`,
          metadata: {
            project_id: projects_id,
            progress: updates.progress,
          },
        });
      }
    }

    return res.json({
      success: true,
      message: "Project updated successfully",
      data: project,
    });
  } catch (error) {
    console.error("Project update failed:", error);

    return res.status(500).json({
      success: false,
      message: "Project update failed",
      error: error.message,
    });
  }
};

// Delete project
const deleteProject = async (req, res) => {
  try {
    const { projects_id } = req.params;

    const project = await Project.findOne({
      where: { projects_id },
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          include: [{ model: User, as: "user" }],
        },
      ],
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found",
      });
    }

    /* ===============================
       PERMISSION CHECK
       =============================== */
    if (req.user.role === "project_manager") {
      const ownerUserId = project.project_manager?.user?.user_id;

      const isOwner = ownerUserId === req.user.user_id;
      const isUnassigned = project.project_managers_id === null;

      if (!isOwner && !isUnassigned) {
        return res.status(403).json({
          success: false,
          message: "Not authorized to delete this project",
        });
      }
    }

    /* ===============================
       STATUS CHECK
       =============================== */
    if (!["planning", "cancelled", "on_hold"].includes(project.status)) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete project that is in progress or completed",
      });
    }

    /* ===============================
       DELETE PROJECT
       =============================== */
    await project.destroy(); // join-table rows auto-removed if FK is correct

    return res.json({
      success: true,
      message: "Project deleted successfully",
    });
  } catch (error) {
    console.error("Project deletion failed:", error);

    return res.status(500).json({
      success: false,
      message: "Project deletion failed",
      error: error.message,
    });
  }
};

// Get project statistics
const getProjectStats = async (req, res) => {
  try {
    const totalProjects = await Project.count();
    const planningProjects = await Project.count({
      where: { status: "planning" },
    });
    const inProgressProjects = await Project.count({
      where: { status: "in_progress" },
    });
    const completedProjects = await Project.count({
      where: { status: "completed" },
    });
    const onHoldProjects = await Project.count({
      where: { status: "on_hold" },
    });
    const cancelledProjects = await Project.count({
      where: { status: "cancelled" },
    });

    // Get projects by status
    const statusStats = await Project.findAll({
      attributes: [
        "status",
        [
          Project.sequelize.fn("COUNT", Project.sequelize.col("status")),
          "count",
        ],
      ],
      group: ["status"],
      raw: true,
    });

    // Get projects by priority
    const priorityStats = await Project.findAll({
      attributes: [
        "priority",
        [
          Project.sequelize.fn("COUNT", Project.sequelize.col("priority")),
          "count",
        ],
      ],
      group: ["priority"],
      raw: true,
    });

    // Get average progress
    const avgProgress = await Project.findOne({
      attributes: [
        [
          Project.sequelize.fn("AVG", Project.sequelize.col("progress")),
          "average_progress",
        ],
      ],
      raw: true,
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalProjects,
          planningProjects,
          inProgressProjects,
          completedProjects,
          onHoldProjects,
          cancelledProjects,
          averageProgress: Math.round(avgProgress.average_progress || 0),
        },
        statusStats,
        priorityStats,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get project statistics",
      error: error.message,
    });
  }
};

module.exports = {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats,
};
