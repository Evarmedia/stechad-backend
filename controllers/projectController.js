const { Project, User, Job, ProjectManager, Engineer } = require("../models");
const { Op } = require("sequelize");
const { createNotification } = require("../utils/notificationUtil");

// Get all projects with filtering and pagination - list
const getAllProjects = async (req, res) => {
  try {
    const { page, limit, status, priority } = req.query;
    const { user_id, role } = req.user;

    /* ===============================
       BASE FILTERS (Project table)
       =============================== */
    const where = {};
    if (status) where.status = status;
    if (priority) where.priority = priority;

    /* ===============================
       ROLE-BASED RESTRICTIONS
       =============================== */
    const include = [];

    if (role === "project_manager") {
      // ✅ safest approach: resolve PM then filter by Project.project_managers_id
      const pm = await ProjectManager.findOne({ where: { user_id } });

      if (!pm) {
        return res.status(404).json({
          success: false,
          message: "Project manager profile not found",
        });
      }

      // PM sees only their projects + unassigned
      where[Op.or] = [
        { project_managers_id: pm.project_managers_id },
        { project_managers_id: null },
      ];
    }

    if (role === "engineer") {
      // Engineers see only projects they are assigned to (M:N)
      // ✅ Important: restrict via include with required: true
      include.push({
        model: Engineer,
        as: "engineers",
        required: true,
        through: { attributes: [] },
        where: { user_id }, // since Engineer has user_id column
        // If you prefer to go through User, use the nested include below instead:
        // include: [{ model: User, as: "user", where: { user_id }, attributes: [] }],
      });
    }

    // Admin → no restriction

    /* ===============================
       PAGINATION
       =============================== */
    const pagination = {};
    if (page && limit) {
      pagination.limit = parseInt(limit);
      pagination.offset = (parseInt(page) - 1) * parseInt(limit);
    }

    /* ===============================
       EAGER LOAD (for response)
       Avoid duplicates: only add these if not already used for restriction
       =============================== */

    // If role !== engineer, we can safely include engineers for display
    if (role !== "engineer") {
      include.push({
        model: Engineer,
        as: "engineers",
        required: false,
        through: { attributes: [] },
        include: [
          {
            model: User,
            as: "user",
            attributes: ["first_name", "last_name", "email"],
          },
        ],
      });
    } else {
      // role === engineer: we already included engineers for restriction,
      // but we still want the user fields in response:
      include[0].include = [
        {
          model: User,
          as: "user",
          attributes: ["first_name", "last_name", "email"],
        },
      ];
    }

    // PM info for display (safe for all roles)
    include.push({
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
    });

    const projects = await Project.findAndCountAll({
      where,
      include,
      order: [["created_at", "DESC"]],
      distinct: true,
      ...pagination,
    });

    // Optional: flag unassigned for frontend
    const rows = projects.rows.map((p) => ({
      ...p.toJSON(),
      is_unassigned: p.project_managers_id === null,
    }));

    return res.json({
      success: true,
      data: {
        projects: rows,
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


// Get Project_manager's project only
const getProjectManagerProjects = async (req, res) => {
  try {
    const { user_id } = req.user;

    // Find the project manager record for the current user
    const projectManager = await ProjectManager.findOne({
      where: { user_id },
    });

    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: "Project manager profile not found",
      });
    }

    // Fetch projects assigned to this project manager
    const projects = await Project.findAll({
      where: { project_managers_id: projectManager.project_managers_id },
      include: [
        {
          model: Engineer,
          as: "engineers",
          through: { attributes: [] },
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
    });

    return res.json({
      success: true,
      data: projects,
    });
  } catch (error) {
    console.error("Failed to get project manager's projects:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get project manager's projects",
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
      engineer_ids = [],
      status = "planning",
      priority = "medium",
      progress = 0,
      team = [],
      tasks = [],
      start_date,
      deadline,
      feedback,
      project_manager_id,
      project_managers_id,
    } = req.body;

    let manager = null;

    if (["admin", "super_admin"].includes(req.user.role)) {
      const assignedManagerId = project_manager_id || project_managers_id;

      if (assignedManagerId) {
        manager = await ProjectManager.findOne({
          where: {
            [Op.or]: [{ project_managers_id: assignedManagerId }, { user_id: assignedManagerId }],
          },
        });

        if (!manager) {
          return res.status(400).json({
            success: false,
            message: "Assigned project manager not found",
          });
        }
      }
    } else {
      manager = await ProjectManager.findOne({
        where: { user_id: req.user.user_id },
      });

      if (!manager) {
        return res.status(403).json({
          success: false,
          message: "Only project managers can create projects",
        });
      }
    }

    const project = await Project.create({
      project_managers_id: manager ? manager.project_managers_id : null,
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
    const allowedFields = ["title", "description", "status", "priority", "progress", "team", "tasks", "start_date", "deadline", "feedback"];
    const updates = Object.fromEntries(
      allowedFields
        .filter((field) => req.body[field] !== undefined)
        .map((field) => [field, req.body[field]]),
    );

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

    if (["admin", "super_admin"].includes(req.user.role)
      && (req.body.project_manager_id !== undefined || req.body.project_managers_id !== undefined)) {
      const assignedManagerId = req.body.project_manager_id ?? req.body.project_managers_id;
      if (assignedManagerId === null || assignedManagerId === "") {
        updates.project_managers_id = null;
      } else {
        const manager = await ProjectManager.findOne({
          where: {
            [Op.or]: [
              { project_managers_id: assignedManagerId },
              { user_id: assignedManagerId },
            ],
          },
        });
        if (!manager) {
          return res.status(400).json({
            success: false,
            message: "Assigned project manager not found",
          });
        }
        updates.project_managers_id = manager.project_managers_id;
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
  getAllProjects,
  getProjectManagerProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats,
};
