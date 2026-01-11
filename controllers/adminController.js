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
const path = require("path");
const { v4: uuidv4, validate: uuidValidate } = require("uuid");

const { uploadToGCP, deleteFromGCP } = require("../middleware/upload");
const { getV4ReadSignedUrl } = require("../config/gcpStorage");
const { toBool, toTextArray } = require("../utils/helpers");
const { formatUserResponse, generateTokens } = require("./authController");

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
    const recentEngineers = await Engineer.findAll({
      limit: 5,
      order: [["created_at", "DESC"]],
      // attributes: [
      //   "user_id",
      //   "first_name",
      //   "last_name",
      //   "email",
      //   "role",
      //   "created_at",
      // ],
      include: [
        {
          model: User,
          as: "user",
          attributes: ["first_name", "last_name", "role", "country"],
        },
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

    const recentProjects = await Project.findAll({
      limit: 3,
      order: [["created_at", "DESC"]],
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
        recentEngineers,
        recentJobs,
        recentProjects,
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

// update admin profile
const updateProfile = async (req, res) => {
  try {
    const admin = await Admin.findOne({
      where: { user_id: req.user.user_id },
      include: [
        {
          model: User,
          as: "user",
          // attributes: {
          //   exclude: [
          //     "password",
          //     "reset_password_token",
          //     "reset_password_expires",
          //   ],
          // },
        },
      ],
    });
    if (!admin) {
      return res
        .status(404)
        .json({ success: false, message: "Admin profile not found" });
    }

    const {
      permissions,
      is_super_admin,
      first_name,
      last_name,
      phone_number,
      city,
      country,
    } = req.body;

    const adminUpdates = {};
    const userUpdates = {};

    // keep the old object so we can delete it after a successful update
    const oldAvatarObjectName = admin.user?.avatar_object_name;

    // 1) If an avatar file is provided, upload it first
    let newAvatarObjectName = null;
    if (req.file) {
      const { objectName } = await uploadToGCP(
        req.file,
        req.user.user_id,
        "profile-images"
      );
      newAvatarObjectName = objectName;
      userUpdates.avatar_object_name = objectName; // store ONLY the object path
    }

    // 2) Coerce/assign other fields
    const permArray = toTextArray(permissions);
    if (permArray !== undefined) adminUpdates.permissions = permArray;

    const superAdmin = toBool(is_super_admin);
    if (superAdmin !== undefined) adminUpdates.is_super_admin = superAdmin;

    if (first_name !== undefined) userUpdates.first_name = first_name;
    if (last_name !== undefined) userUpdates.last_name = last_name;
    if (phone_number !== undefined) userUpdates.phone_number = phone_number;
    if (city !== undefined) userUpdates.city = city;
    if (country !== undefined) userUpdates.country = country;

    // 3) Persist updates
    if (Object.keys(adminUpdates).length) await admin.update(adminUpdates);
    if (Object.keys(userUpdates).length) await admin.user.update(userUpdates);

    // 4) Only now that DB points to the new object, delete the old file (if different)
    if (
      req.file &&
      oldAvatarObjectName &&
      oldAvatarObjectName !== newAvatarObjectName
    ) {
      try {
        await deleteFromGCP(oldAvatarObjectName);
      } catch (e) {
        // don't fail the whole request if cleanup fails
        console.warn("Failed to delete old avatar:", e?.message || e);
      }
    }

    // 5) Re-fetch and return a fresh signed URL (temporary)
    const updated = await Admin.findOne({
      where: { user_id: req.user.user_id },
      include: [
        {
          model: User,
          as: "user",
        },
      ],
    });

    // Get full user with all associations
    const userWithAssociations = await User.findByPk(req.user.user_id, {
      include: [{ model: Admin, as: "admin" }],
    });

    // Format user response with signed URLs
    const formattedUser = await formatUserResponse(userWithAssociations);

    // Generate tokens
    const { token, refreshToken } = generateTokens({
      user_id: req.user.user_id,
      role: userWithAssociations.role,
    });

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: formattedUser,
        token,
        refreshToken,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Profile update failed",
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

// Get all project managers - list
const getProjectManagers = async (req, res) => {
  try {
    const { page, limit, is_verified } = req.query;

    const where = {};
    if (is_verified !== undefined) {
      where.is_verified = is_verified === "true";
    }

    const pagination = {
      limit: limit ? parseInt(limit) : undefined,
      offset:
        page && limit ? (parseInt(page) - 1) * parseInt(limit) : undefined,
    };

    const projectManagers = await ProjectManager.findAndCountAll({
      where: Object.keys(where).length ? where : undefined,

      include: [
        {
          model: User,
          as: "user",
        },
        {
          model: Project,
          as: "pm_projects",
          required: false, // LEFT JOIN stays intact
          on: {
            [Op.or]: [
              // PM-owned projects
              {
                project_managers_id: {
                  [Op.col]: "ProjectManager.project_managers_id",
                },
              },
              // Unassigned projects
              { project_managers_id: null },
            ],
          },
        },
      ],

      ...pagination,
      distinct: true,
      order: [["created_at", "DESC"]],
    });

    const transformedPMs = projectManagers.rows.map((pm) => {
      const pmJson = pm.toJSON();

      pmJson.pm_projects = (pmJson.pm_projects || []).map((p) => ({
        ...p,
        is_unassigned: p.project_managers_id === null,
      }));

      return pmJson;
    });

    return res.json({
      success: true,
      data: {
        projectManagers: transformedPMs,
        pagination: {
          totalItems: projectManagers.count,
        },
      },
    });
  } catch (error) {
    console.error("Failed to get project managers:", error);

    return res.status(500).json({
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

    // 1️⃣ Check if user already exists
    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "User already exists with this email. Please login.",
      });
    }

    // 2️⃣ Check for existing pending invite
    const existingInvite = await Invite.findOne({
      where: { email, status: "pending" },
      order: [["created_at", "DESC"]],
    });

    // 3️⃣ If pending invite exists AND is NOT expired → block
    if (existingInvite && new Date() < existingInvite.expires_at) {
      return res.status(400).json({
        success: false,
        message: "An active invitation has already been sent to this email.",
      });
    }

    // 4️⃣ If pending invite exists BUT is expired → invalidate it
    if (existingInvite && new Date() >= existingInvite.expires_at) {
      await existingInvite.update({
        status: "expired",
        token: null,
        temp_password: null,
      });
    }

    // =========================
    // ✅ CREATE NEW INVITE
    // =========================

    const tempPassword = Math.random().toString(36).slice(-8);
    const token = uuidv4();
    const expires_at = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour

    const invitedUser = await Invite.create({
      email,
      temp_password: tempPassword,
      role,
      token,
      invited_by_user_id: req.user.user_id,
      sent_at: new Date(),
      expires_at,
      status: "pending",
    });

    // 5️⃣ Send email
    const htmlFilePath = path.join(
      __dirname,
      "../templates/projectManagerInvitation.html"
    );

    const replacements = {
      firstname: first_name,
      tempPassword,
      year: new Date().getFullYear(),
      url: `${process.env.FRONTEND_URL}/set-password?token=${token}`,
    };

    await sendEmail({
      to: invitedUser.email,
      subject: "Invitation to Stechad Engineer Management Platform",
      htmlFilePath,
      replacements,
    });

    res.status(201).json({
      success: true,
      message: "Project manager invited successfully.",
    });
  } catch (error) {
    console.error(error);
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
        status: ["in_progress"],
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

// Get engineers pending vetting
const getEngineerVetting = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const engineers = await Engineer.findAndCountAll({
      where: { is_vetted: false, is_onboarded: true },
      include: [
        {
          model: User,
          as: "user",
          // attributes: {
          //   exclude: [
          //     "password",
          //     "reset_password_token",
          //     "reset_password_expires",
          //   ],
          // },
        },
      ],
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
  updateProfile,
  getEngineerDetails,
  vetEngineer,
  removeVetting,
  deleteEngineer,
  getProjectManagers,
  inviteProjectManager,
  getProjectManagerDetails,
  deleteProjectManager,
  getEngineerVetting,
  getSettings,
  updateSettings,
  // getPmsProjectById,
};
