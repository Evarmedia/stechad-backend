const { Project, User, Job, ProjectManager, Talent } = require("../models");
const { Op } = require("sequelize");
const { hasPermission } = require("../utils/permissions");

async function canViewProject(project, user) {
  const role = getRoleKey(user);
  if (["admin", "super_admin"].includes(role)) return true;
  if (project.created_by_user_id === user.user_id && await hasPermission(user, "create_projects")) return true;
  if (role === "project_manager") return !project.project_managers_id || project.project_manager?.user_id === user.user_id;
  return project.created_by_user_id === user.user_id && await hasPermission(user, "create_projects");
}
const { createNotification } = require("../utils/notificationUtil");
const { getRoleKey } = require("../utils/roleUtils");

// Lock the current account before project rows so queued mutations observe
// account/individual-grant changes committed after REST authentication.
async function lockProjectActor(req, transaction) {
  const actor = await User.findByPk(req.user.user_id, { transaction, lock: { level: transaction.LOCK.UPDATE, of: User } });
  if (!actor?.is_active || actor.session_version !== req.user.session_version) throw Object.assign(new Error("Your session is no longer available"), { status: 401 });
  return actor;
}

// Get all projects with filtering and pagination - list
const getAllProjects = async (req, res) => {
  try {
    const { page, limit, status, priority, created_by_me } = req.query;
    if (created_by_me !== undefined && !["true", "false"].includes(created_by_me)) return res.status(400).json({ success: false, message: "created_by_me must be true or false" });
    const ownOnly = created_by_me === "true";
    const { user_id } = req.user;
    const role = getRoleKey(req.user);

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

    if (role === "project_manager" && !ownOnly) {
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
        ...(await hasPermission(req.user, "create_projects") ? [{ created_by_user_id: user_id }] : []),
      ];
    }

    if (ownOnly || !["admin", "super_admin", "project_manager"].includes(role)) {
      where.created_by_user_id = user_id;
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

    include.push({ model: Talent, as: "talents", required: false, through: { attributes: [] }, include: [{ model: User, paranoid: false, as: "user", attributes: ["first_name", "last_name", "email"] }] });

    // PM info for display (safe for all roles)
    include.push({
      model: ProjectManager,
      as: "project_manager",
      required: false,
      include: [
        {
          model: User, paranoid: false,
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
          model: Talent,
          as: "talents",
          through: { attributes: [] },
          required: false,
          include: [
            {
              model: User, paranoid: false,
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
              model: User, paranoid: false,
              as: "user",
              attributes: ["first_name", "last_name", "email", "phone_number"],
            },
          ],
        },

        // 🔹 Talents (Many-to-Many)
        {
          model: Talent,
          as: "talents",
          through: { attributes: [] },
          required: false,
          include: [
            {
              model: User, paranoid: false,
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

    if (!await canViewProject(project, req.user)) return res.status(403).json({ success: false, message: "Access denied to this project" });

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
    const { title, description, talent_ids = [], status = "planning", priority = "medium", progress = 0, team = [], tasks = [], start_date, deadline, feedback, project_manager_id, project_managers_id } = req.body;
    if (typeof title !== "string" || !title.trim()) return res.status(400).json({ success: false, message: "Project title is required" });
    if (!["planning", "in_progress", "completed", "on_hold", "cancelled"].includes(status) || !["low", "medium", "high", "critical"].includes(priority) || !Number.isInteger(progress) || progress < 0 || progress > 100 || !Array.isArray(team) || team.some((member) => typeof member !== "string") || !Array.isArray(tasks) || !Array.isArray(talent_ids)) return res.status(400).json({ success: false, message: "Invalid project status, priority, progress, team, tasks, or talent assignments" });
    for (const date of [start_date, deadline].filter(Boolean)) if (typeof date !== "string" || !Number.isFinite(Date.parse(date))) return res.status(400).json({ success: false, message: "Project dates must be valid dates" });
    if (start_date && deadline && new Date(start_date) > new Date(deadline)) return res.status(400).json({ success: false, message: "Project deadline must be after its start date" });
    const role = getRoleKey(req.user);
    if (!["admin", "super_admin", "project_manager"].includes(role) && (project_manager_id || project_managers_id || talent_ids.length)) return res.status(403).json({ success: false, message: "Project creation does not grant manager or talent assignment access" });
    const project = await require("../config/database").transaction(async (transaction) => {
      await require("../utils/reporting").lockHierarchy(transaction);
      let manager = null;
      if (["admin", "super_admin"].includes(role)) {
        const assigned = project_manager_id || project_managers_id;
        if (assigned) {
          require("../utils/http").requireUuid(assigned);
          manager = await ProjectManager.findOne({ where: { [Op.or]: [{ project_managers_id: assigned }, { user_id: assigned }] }, include: [{ model: User, as: "user", required: true, where: { is_active: true }, include: [{ ...require("../utils/roleUtils").ROLE_INCLUDE, where: { role_key: "project_manager" } }] }], transaction });
          if (!manager) throw Object.assign(new Error("Assigned project manager is unavailable"), { status: 400 });
        }
      } else if (role === "project_manager") {
        manager = await ProjectManager.findOne({ where: { user_id: req.user.user_id }, transaction });
        if (!manager) throw Object.assign(new Error("Project manager profile not found"), { status: 403 });
      }
      const ids = [...new Set(talent_ids)]; ids.forEach(require("../utils/http").requireUuid);
      const talents = ids.length ? await Talent.findAll({ where: { talent_id: ids }, include: [{ model: User, as: "user", required: true, where: { is_active: true }, include: [{ ...require("../utils/roleUtils").ROLE_INCLUDE, where: { role_key: "talent" } }] }], transaction }) : [];
      if (talents.length !== ids.length) throw Object.assign(new Error("One or more assigned talents are unavailable"), { status: 400 });
      const row = await Project.create({ title: title.trim(), description, status, priority, progress, team, tasks, start_date: start_date || null, deadline: deadline || null, feedback, created_by_user_id: req.user.user_id, project_managers_id: manager?.project_managers_id || null }, { transaction });
      if (talents.length) await row.addTalents(talents, { transaction });
      return row;
    });
    return res.status(201).json({ success: true, message: "Project created successfully", data: project });
  } catch (error) { return res.status(error.status || (error.name === "SequelizeValidationError" ? 400 : 500)).json({ success: false, message: error.status || error.name === "SequelizeValidationError" ? error.message : "Project creation failed" }); }
};

// Update project
const updateProject = async (req, res) => {
  try {
    const allowedFields = ["title", "description", "status", "priority", "progress", "team", "tasks", "start_date", "deadline", "feedback"];
    const updates = Object.fromEntries(allowedFields.filter((field) => req.body[field] !== undefined).map((field) => [field, req.body[field]]));
    const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
    if (updates.title !== undefined && (typeof updates.title !== "string" || !updates.title.trim())) fail("Project title is required");
    if (updates.title) updates.title = updates.title.trim();
    if (updates.status !== undefined && !["planning", "in_progress", "completed", "on_hold", "cancelled"].includes(updates.status)) fail("Invalid project status");
    if (updates.priority !== undefined && !["low", "medium", "high", "critical"].includes(updates.priority)) fail("Invalid project priority");
    if (updates.progress !== undefined && (!Number.isInteger(updates.progress) || updates.progress < 0 || updates.progress > 100)) fail("Progress must be a whole number from 0 to 100");
    if (updates.team !== undefined && (!Array.isArray(updates.team) || updates.team.some((member) => typeof member !== "string"))) fail("Team must be an array of names");
    if (updates.tasks !== undefined && !Array.isArray(updates.tasks)) fail("Tasks must be an array");
    for (const date of [updates.start_date, updates.deadline].filter(Boolean)) if (typeof date !== "string" || !Number.isFinite(Date.parse(date))) fail("Project dates must be valid dates");
    const result = await require("../config/database").transaction(async (transaction) => {
      await require("../utils/reporting").lockHierarchy(transaction);
      const actor = await lockProjectActor(req, transaction);
      const role = getRoleKey(actor);
      const project = await Project.findByPk(require("../utils/http").requireUuid(req.params.projects_id), {
        include: [
          { model: ProjectManager, as: "project_manager", include: [{ model: User, as: "user" }] },
          { model: Talent, as: "talents", through: { attributes: [] }, include: [{ model: User, as: "user" }] },
        ], transaction, lock: { level: transaction.LOCK.UPDATE, of: Project },
      });
      if (!project) fail("Project not found", 404);
      const legacyEditor = ["admin", "super_admin"].includes(role)
        || (role === "project_manager" && (!project.project_managers_id || project.project_manager?.user_id === req.user.user_id))
        || (role === "talent" && project.talents?.some((talent) => talent.user_id === req.user.user_id));
      const creator = project.created_by_user_id === req.user.user_id && await hasPermission(actor, "create_projects");
      if (!legacyEditor && !creator) fail("Not authorized to update this project", 403);
      if (!legacyEditor && Object.keys(req.body).some((key) => !["title", "description", "priority", "deadline"].includes(key))) fail("Creators may edit only title, description, priority and deadline", 403);
      if (req.body.created_by_user_id !== undefined) fail("Project ownership cannot be changed", 403);
      if (["admin", "super_admin"].includes(role) && (req.body.project_manager_id !== undefined || req.body.project_managers_id !== undefined)) {
        const assigned = req.body.project_manager_id ?? req.body.project_managers_id;
        updates.project_managers_id = null;
        if (assigned) {
          require("../utils/http").requireUuid(assigned);
          const manager = await ProjectManager.findOne({ where: { [Op.or]: [{ project_managers_id: assigned }, { user_id: assigned }] }, include: [{ model: User, as: "user", required: true, where: { is_active: true }, include: [{ ...require("../utils/roleUtils").ROLE_INCLUDE, where: { role_key: "project_manager" } }] }], transaction });
          if (!manager) fail("Assigned project manager is unavailable");
          updates.project_managers_id = manager.project_managers_id;
        }
      }
      let talents;
      if (req.body.talent_ids !== undefined) {
        if (!["admin", "super_admin", "project_manager"].includes(role)) fail("Talent reassignment requires management access", 403);
        if (!Array.isArray(req.body.talent_ids)) fail("Talent assignments must be an array");
        const ids = [...new Set(req.body.talent_ids)]; ids.forEach(require("../utils/http").requireUuid);
        talents = ids.length ? await Talent.findAll({ where: { talent_id: ids }, include: [{ model: User, as: "user", required: true, where: { is_active: true }, include: [{ ...require("../utils/roleUtils").ROLE_INCLUDE, where: { role_key: "talent" } }] }], transaction }) : [];
        if (talents.length !== ids.length) fail("One or more assigned talents are unavailable");
      }
      if (["planning", "in_progress", "on_hold"].includes(updates.status || project.status)) {
        if (project.project_managers_id && updates.project_managers_id === undefined && !project.project_manager?.user?.is_active) fail("Reassign the unavailable project manager before activating this project");
        if (!talents && project.talents?.some((talent) => !talent.user?.is_active)) fail("Reassign unavailable talents before activating this project");
      }
      const start = updates.start_date === undefined ? project.start_date : updates.start_date;
      const deadline = updates.deadline === undefined ? project.deadline : updates.deadline;
      if (start && deadline && new Date(start) > new Date(deadline)) fail("Project deadline must be after its start date");
      const oldStatus = project.status, oldProgress = project.progress;
      await project.update(updates, { transaction });
      if (talents) { await project.setTalents(talents, { transaction }); project.setDataValue("talents", talents); }
      return { project, oldStatus, oldProgress };
    });
    const { project, oldStatus, oldProgress } = result;
    for (const userId of project.talents?.map((talent) => talent.user?.user_id).filter(Boolean) || []) {
      if (updates.status && oldStatus !== updates.status) await createNotification({ user_id: userId, title: "Project Status Updated", message: `Project "${project.title}" status changed to ${updates.status}`, type: "info", action_url: `/projects/${project.projects_id}`, metadata: { project_id: project.projects_id, old_status: oldStatus, new_status: updates.status } });
      if (typeof updates.progress === "number" && updates.progress !== oldProgress && updates.progress % 25 === 0) await createNotification({ user_id: userId, title: "Project Milestone", message: `Project "${project.title}" is now ${updates.progress}% complete`, type: "success", action_url: `/projects/${project.projects_id}`, metadata: { project_id: project.projects_id, progress: updates.progress } });
    }
    return res.json({ success: true, message: "Project updated successfully", data: project });
  } catch (error) { return res.status(error.status || (error.name === "SequelizeValidationError" ? 400 : 500)).json({ success: false, message: error.status || error.name === "SequelizeValidationError" ? error.message : "Project update failed" }); }
};

// Delete project
const deleteProject = async (req, res) => {
  try {
    await require("../config/database").transaction(async (transaction) => {
      await require("../utils/reporting").lockHierarchy(transaction);
      const actor = await lockProjectActor(req, transaction);
      const project = await Project.findByPk(require("../utils/http").requireUuid(req.params.projects_id), {
        include: [{ model: ProjectManager, as: "project_manager", include: [{ model: User, as: "user" }] }],
        transaction, lock: { level: transaction.LOCK.UPDATE, of: Project },
      });
      const fail = (message, status) => { throw Object.assign(new Error(message), { status }); };
      if (!project) fail("Project not found", 404);
      const role = getRoleKey(actor);
      const admin = ["admin", "super_admin"].includes(role);
      const manager = role === "project_manager" && (!project.project_managers_id || project.project_manager?.user_id === req.user.user_id);
      const creator = project.created_by_user_id === req.user.user_id && await hasPermission(actor, "create_projects");
      if (!admin && !manager && !creator) fail("Not authorized to delete this project", 403);
      if (!admin && !["planning", "on_hold", "cancelled"].includes(project.status)) fail("Cannot delete project that is in progress or completed", 400);
      await project.destroy({ transaction });
    });
    return res.json({ success: true, message: "Project deleted successfully" });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.status ? error.message : "Project deletion failed" });
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
