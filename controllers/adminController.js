const {
  User,
  Engineer,
  ProjectManager,
  Admin,
  Job,
  Application,
  Project,
  Setting,
  Invite,
} = require("../models");
const { Op } = require("sequelize");
const sendEmail = require("../utils/sendEmail");
const { generateTokens } = require("../utils/generateTokens");
const path = require("path");
const { v4: uuidv4, validate: uuidValidate } = require("uuid"); // Import UUID validation

// Get admin dashboard overview
const getDashboard = async (req, res) => {
  try {
    // Get overall platform statistics
    const totalUsers = await User.count();
    const totalEngineers = await Engineer.count();
    const totalProjectManagers = await ProjectManager.count();
    const totalJobs = await Job.count();
    const totalApplications = await Application.count();
    const totalProjects = await Project.count();

    // Get recent activity
    const recentUsers = await User.findAll({
      limit: 5,
      order: [["created_at", "DESC"]],
      attributes: [
        "user_id",
        "first_name",
        "last_name",
        "email",
        "role",
        "created_at",
      ],
    });

    const recentJobs = await Job.findAll({
      limit: 5,
      order: [["created_at", "DESC"]],
      include: [
        {
          model: User,
          as: "poster",
          attributes: ["first_name", "last_name", "role"],
        },
      ],
    });

    // Get growth metrics (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const newUsersThisMonth = await User.count({
      where: { created_at: { [Op.gte]: thirtyDaysAgo } },
    });

    const newJobsThisMonth = await Job.count({
      where: { created_at: { [Op.gte]: thirtyDaysAgo } },
    });

    const dashboardData = {
      statistics: {
        totalUsers,
        totalEngineers,
        totalProjectManagers,
        totalJobs,
        totalApplications,
        totalProjects,
        newUsersThisMonth,
        newJobsThisMonth,
      },
      recentActivity: {
        recentUsers,
        recentJobs,
      },
    };

    res.json({
      success: true,
      data: dashboardData,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get dashboard data",
      error: error.message,
    });
  }
};

// Get platform statistics
const getStats = async (req, res) => {
  try {
    const { period = "month" } = req.query;

    let dateFilter;
    const now = new Date();

    switch (period) {
      case "week":
        dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "quarter":
        dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case "year":
        dateFilter = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // User statistics
    const userStats = {
      total: await User.count(),
      new: await User.count({
        where: { created_at: { [Op.gte]: dateFilter } },
      }),
      engineers: await Engineer.count(),
      projectManagers: await ProjectManager.count(),
      admins: await Admin.count(),
    };

    // Job statistics
    const jobStats = {
      total: await Job.count(),
      open: await Job.count({ where: { status: "active" } }),
      closed: await Job.count({ where: { status: "closed" } }),
      // completed: await Job.count({ where: { status: 'completed' } }),
      new: await Job.count({ where: { created_at: { [Op.gte]: dateFilter } } }),
    };

    // Application statistics
    const applicationStats = {
      total: await Application.count(),
      pending: await Application.count({ where: { status: "pending" } }),
      hired: await Application.count({ where: { status: "accepted" } }),
      rejected: await Application.count({ where: { status: "rejected" } }),
      new: await Application.count({
        where: { created_at: { [Op.gte]: dateFilter } },
      }),
    };

    // Project statistics
    const projectStats = {
      total: await Project.count(),
      active: await Project.count({
        where: { status: ["planning", "in_progress"] },
      }),
      completed: await Project.count({ where: { status: "completed" } }),
      // cancelled: await Project.count({ where: { status: 'cancelled' } })
    };

    res.json({
      success: true,
      data: {
        period,
        users: userStats,
        jobs: jobStats,
        applications: applicationStats,
        projects: projectStats,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get statistics",
      error: error.message,
    });
  }
};

// Get admin profile
const getProfile = async (req, res) => {
  try {
    const admin = await User.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: Admin, as: "admin" }],
    });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found",
      });
    }

    res.json({
      success: true,
      data: admin,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get profile",
      error: error.message,
    });
  }
};

// Update admin profile
const updateProfile = async (req, res) => {
  try {
    const admin = await Admin.findOne({ where: { user_id: req.user.user_id } });

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found",
      });
    }

    const { permissions, is_super_admin } = req.body;
    const updates = {};

    if (permissions !== undefined) {
      updates.permissions = permissions;
    }
    if (is_super_admin !== undefined) {
      updates.is_super_admin = is_super_admin;
    }

    await admin.update(updates);

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: admin,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Profile update failed",
      error: error.message,
    });
  }
};

// Get all engineers with pagination
const getEngineers = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      is_onboarded,
      availability = "available",
    } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (is_onboarded !== undefined) {
      where.is_onboarded = is_onboarded === "true";
    }
    if (availability) {
      where.availability = availability;
    }

    const engineers = await Engineer.findAndCountAll({
      where,
      include: [{ model: User, as: "user" }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        engineers: engineers.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(engineers.count / limit),
          totalItems: engineers.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get engineers",
      error: error.message,
    });
  }
};

// Get specific engineer details
const getEngineerDetails = async (req, res) => {
  try {
    const { engineer_id } = req.params;

    const engineer = await Engineer.findOne({
      where: { engineer_id },
      include: [
        { model: User, as: "user" },
        {
          model: Application,
          as: "applications",
          include: [{ model: Job, as: "job" }],
        },
        { model: Project, as: "engineer_projects", include: [{ model: User }] },
      ],
    });

    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Engineer not found",
      });
    }

    res.json({
      success: true,
      data: engineer,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get engineer details",
      error: error.message,
    });
  }
};

// Vet an engineer
const vetEngineer = async (req, res) => {
  try {
    const { engineer_id } = req.params;

    const engineer = await Engineer.findByPk(engineer_id);
    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Engineer not found",
      });
    }

    await engineer.update({
      is_vetted: true,
      vetted_at: new Date(),
      vetted_by: req.user.user_id,
    });

    const updatedEngineer = await Engineer.findByPk(engineer_id, {
      include: [{ model: User, as: "vettedBy" }],
    });

    res.json({
      success: true,
      message: "Engineer vetted successfully",
      data: updatedEngineer,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to vet engineer",
      error: error.message,
    });
  }
};

// Remove engineer vetting
const removeVetting = async (req, res) => {
  try {
    const { engineer_id } = req.params;

    const engineer = await Engineer.findByPk(engineer_id);
    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Engineer not found",
      });
    }

    await engineer.update({
      is_vetted: false,
      vetted_at: null,
      vetted_by: null,
    });

    res.json({
      success: true,
      message: "Engineer vetting removed successfully",
      data: engineer,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to remove vetting",
      error: error.message,
    });
  }
};

// Delete engineer account
const deleteEngineer = async (req, res) => {
  try {
    const { engineer_id } = req.params;

    const engineer = await Engineer.findByPk(engineer_id, {
      include: [{ model: User, as: "user" }],
    });

    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: "Engineer not found",
      });
    }

    // Check for active projects
    const activeProjects = await Project.count({
      where: {
        engineer_id: engineer.user_id,
        status: ["planning", "in_progress"],
      },
    });

    if (activeProjects > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete engineer with active projects",
      });
    }

    // Delete engineer and user
    await engineer.destroy();
    await engineer.user.destroy();

    res.json({
      success: true,
      message: "Engineer deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete engineer",
      error: error.message,
    });
  }
};

// Get all project managers
const getProjectManagers = async (req, res) => {
  try {
    const { page = 1, limit = 10, is_verified } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (is_verified !== undefined) {
      where.is_verified = is_verified === "true";
    }

    const projectManagers = await ProjectManager.findAndCountAll({
      where,
      include: [{ model: User, as: "user" }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        projectManagers: projectManagers.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(projectManagers.count / limit),
          totalItems: projectManagers.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get project managers",
      error: error.message,
    });
  }
};

// Invite new project manager
const inviteProjectManager = async (req, res) => {
  try {
    const { email, first_name, role = "project_manager" } = req.body;

    // Generate temporary password
    const tempPassword = Math.random().toString(36).slice(-8);

    // Generate token
    const token = uuidv4();

    // Check if user already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email, Please Login",
      });
    }

    // Create invited user
    const invitedUser = await Invite.create({
      email,
      temp_password: tempPassword, // set to temp_password Later
      role: role,
      first_name,
      token,
      invited_by_user_id: req.user.user_id,
      sent_at: new Date(),
    });

    const htmlFilePath = path.join(
      __dirname,
      "../templates/projectManagerInvitation.html"
    );

    const replacements = {
      firstname: first_name,
      tempPassword, // remember to embed token in link
      year: new Date().getFullYear(),
      token,
    };

    // Send invitation email
    await sendEmail({
      to: invitedUser.email,
      subject: "Invitation to Stechad Engineer Management Platform",
      htmlFilePath,
      replacements,
    });

    res.status(201).json({
      success: true,
      message: "Project manager invited successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to invite project manager",
      error: error.message,
    });
  }
};

// Get specific project manager details
const getProjectManagerDetails = async (req, res) => {
  try {
    let { project_managers_id } = req.params;

    // Log the project_manager_id to check the value passed
    console.log(`Received project_manager_id: '${project_managers_id}'`);

    // Trim any leading or trailing whitespace
    project_managers_id = project_managers_id.trim();

    // Validate that the project_managers_id is a valid UUID
    if (!uuidValidate(project_managers_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid project manager ID format. It must be a valid UUID.",
      });
    }

    // Use the correct aliases in the include section
    const projectManager = await ProjectManager.findOne({
      where: { project_managers_id: project_managers_id },
      include: [
        { model: User, as: "user" }, // ProjectManager's associated user
        { model: Job, as: "posted_jobs" },
        {
          model: Project,
          as: "pm_projects", // Projects associated with the ProjectManager
          include: [
            {
              model: User,
              as: "engineer", // Engineer associated with the Project
            },
          ],
        },
      ],
    });

    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: "Project manager not found",
      });
    }

    res.json({
      success: true,
      data: projectManager,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get project manager details",
      error: error.message,
    });
  }
};

// Delete project manager account
const deleteProjectManager = async (req, res) => {
  try {
    const { project_managers_id } = req.params;

    const projectManager = await ProjectManager.findByPk(project_managers_id, {
      include: [{ model: User, as: "user" }],
    });

    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: "Project manager not found",
      });
    }

    // Check for active projects
    const activeProjects = await Project.count({
      where: {
        project_managers_user_id: projectManager.user_id,
        status: ["in_progress",],
      },
    });

    if (activeProjects > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete project manager with active projects",
      });
    }

    // Delete project manager and user
    await projectManager.destroy();
    await projectManager.user.destroy();

    res.json({
      success: true,
      message: "Project manager deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete project manager",
      error: error.message,
    });
  }
};

// Get all jobs on platform
const getJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (status) {
      where.status = status;
    }

    const jobs = await Job.findAndCountAll({
      where,
      include: [
        { model: User, as: "poster", attributes: ["first_name", "last_name"] },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        jobs: jobs.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(jobs.count / limit),
          totalItems: jobs.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get jobs",
      error: error.message,
    });
  }
};

// Get specific job details
const getJobDetails = async (req, res) => {
  try {
    const { jobs_id } = req.params;

    const job = await Job.findOne({
      where: { jobs_id },
      include: [
        { model: User, as: "poster", attributes: ["first_name", "last_name"] },
        {
          model: Application,
          as: "applications",
          include: [{ model: User, as: "engineer" }],
        },
      ],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    res.json({
      success: true,
      data: job,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get job details",
      error: error.message,
    });
  }
};

// Delete job posting
const deleteJob = async (req, res) => {
  try {
    const { jobs_id } = req.params;

    const job = await Job.findByPk(jobs_id);
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // Check for applications
    const applicationCount = await Application.count({
      where: { job_id: jobs_id },
    });

    if (applicationCount > 0) {
      return res.status(400).json({
        success: false,
        message: "Cannot delete job with existing applications",
      });
    }

    await job.destroy();

    res.json({
      success: true,
      message: "Job deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete job",
      error: error.message,
    });
  }
};

// Get all applications on platform
const getApplications = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = {};
    if (status) {
      where.status = status;
    }

    const applications = await Application.findAndCountAll({
      where,
      include: [
        { model: Job, as: "job", attributes: ["title"] },
        {
          model: User,
          as: "applicant",
          attributes: ["first_name", "last_name"],
        },
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        applications: applications.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(applications.count / limit),
          totalItems: applications.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get applications",
      error: error.message,
    });
  }
};

// Get specific application details
const getApplicationDetails = async (req, res) => {
  try {
    const { applications_id } = req.params;

    const application = await Application.findOne({
      where: { applications_id },
      include: [
        { model: Job, as: "job", include: [{ model: User, as: "poster", attributes: ["first_name", "last_name"] }] },
        {
          model: User,
          as: "applicant",
          attributes: ["first_name", "last_name"],
        },
      ],
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: "Application not found",
      });
    }

    res.json({
      success: true,
      data: application,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get application details",
      error: error.message,
    });
  }
};

// Get engineers pending vetting
const getEngineerVetting = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const engineers = await Engineer.findAndCountAll({
      where: { is_vetted: false, is_onboarded: true },
      include: [{ model: User, as: "user", attributes: { exclude: ['password', 'reset_password_token', 'reset_password_expires'] } },],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [["created_at", "ASC"]],
    });

    res.json({
      success: true,
      data: {
        engineers: engineers.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(engineers.count / limit),
          totalItems: engineers.count,
          itemsPerPage: parseInt(limit),
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get engineers pending vetting",
      error: error.message,
    });
  }
};

// Get platform settings
const getSettings = async (req, res) => {
  try {
    const settings = await Setting.findAll();

    const settingsObject = {};
    settings.forEach((setting) => {
      let value = setting.value;

      // Parse value based on type
      switch (setting.type) {
        case "number":
          value = parseFloat(value);
          break;
        case "boolean":
          value = value === "true";
          break;
        case "json":
          value = JSON.parse(value);
          break;
        default:
          // string - no parsing needed
          break;
      }

      settingsObject[setting.key] = value;
    });

    res.json({
      success: true,
      data: settingsObject,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get settings",
      error: error.message,
    });
  }
};

// Update platform settings
const updateSettings = async (req, res) => {
  try {
    const { settings } = req.body;

    for (const [key, value] of Object.entries(settings)) {
      let type = "string";
      let stringValue = value;

      // Determine type and convert to string
      if (typeof value === "number") {
        type = "number";
        stringValue = value.toString();
      } else if (typeof value === "boolean") {
        type = "boolean";
        stringValue = value.toString();
      } else if (typeof value === "object") {
        type = "json";
        stringValue = JSON.stringify(value);
      }

      await Setting.upsert({
        key,
        value: stringValue,
        type,
      });
    }

    res.json({
      success: true,
      message: "Settings updated successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update settings",
      error: error.message,
    });
  }
};

module.exports = {
  getDashboard,
  getStats,
  getProfile,
  updateProfile,
  getEngineers,
  getEngineerDetails,
  vetEngineer,
  removeVetting,
  deleteEngineer,
  getProjectManagers,
  inviteProjectManager,
  getProjectManagerDetails,
  deleteProjectManager,
  getJobs,
  getJobDetails,
  deleteJob,
  getApplications,
  getApplicationDetails,
  getEngineerVetting,
  getSettings,
  updateSettings,
};
