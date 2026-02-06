const {
  User,
  Engineer,
  ProjectManager,
  Job,
  Application,
  Project,
} = require("../models");
const { uploadToGCP, deleteFromGCP } = require("../middleware/upload");
const { getV4ReadSignedUrl } = require("../config/gcpStorage");
const { formatUserResponse, generateTokens } = require("./authController");
const { Op } = require("sequelize");

// Get project manager dashboard
const getDashboard = async (req, res) => {
  const now = new Date();
  const last30Days = new Date();
  last30Days.setDate(now.getDate() - 30);

  const previous30Days = new Date();
  previous30Days.setDate(now.getDate() - 60);
  try {
    const projectManager = await ProjectManager.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: "user" }],
    });

    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: "Project manager profile not found",
      });
    }

    const pmId = projectManager.project_managers_id;

    /* ===============================
       JOB STATS (PM ONLY)
       =============================== */
    const totalJobsCount = await Job.count({
      where: { posted_by: req.user.user_id },
    });

    const activeJobsCount = await Job.count({
      where: {
        posted_by: req.user.user_id,
        status: "active",
      },
    });

    /* ===============================
       APPLICATION STATS (PM JOBS)
       =============================== */
    const totalApplicationsCount = await Application.count({
      include: [
        {
          model: Job,
          as: "job",
          where: { posted_by: req.user.user_id },
        },
      ],
      distinct: true,
    });

    /* ===============================
       PROJECT STATS
       =============================== */
    const activeProjects = await Project.findAll({
      where: {
        status: ["planning", "in_progress"],
      },
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          where: {
            [Op.or]: [
              { project_managers_id: pmId },
              { project_managers_id: null },
            ],
          },
        },
      ],
    });

    const totalProjectsCount = await Project.count({
      where: { status: "completed" },
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          where: {
            [Op.or]: [
              { project_managers_id: pmId },
              { project_managers_id: null },
            ],
          },
        },
      ],
      distinct: true,
    });

    const completedProjectsCount = await Project.count({
      where: {
        status: "completed",
      },
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          where: {
            [Op.or]: [
              { project_managers_id: pmId },
              { project_managers_id: null },
            ],
          },
        },
      ],
      distinct: true,
    });

    const totalProjectsAllTime = await Project.count({
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          where: {
            [Op.or]: [
              { project_managers_id: pmId },
              { project_managers_id: null },
            ],
          },
        },
      ],
      distinct: true,
    });

    const successRate = totalProjectsAllTime
      ? Math.round((completedProjectsCount / totalProjectsAllTime) * 100)
      : 0;

    const completedLast30Days = await Project.count({
      where: {
        status: "completed",
        updated_at: {
          [Op.gte]: last30Days,
        },
      },
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          where: {
            [Op.or]: [
              { project_managers_id: pmId },
              { project_managers_id: null },
            ],
          },
        },
      ],
      distinct: true,
    });

    const completedPrevious30Days = await Project.count({
      where: {
        status: "completed",
        updated_at: {
          [Op.between]: [previous30Days, last30Days],
        },
      },
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          where: {
            [Op.or]: [
              { project_managers_id: pmId },
              { project_managers_id: null },
            ],
          },
        },
      ],
      distinct: true,
    });

    let successRateChange = 0;

    if (completedPrevious30Days > 0) {
      successRateChange =
        ((completedLast30Days - completedPrevious30Days) /
          completedPrevious30Days) *
        100;
    }

    successRateChange = Math.round(successRateChange);

    /* ===============================
       RECENT APPLICATIONS
       =============================== */
    const recentApplications = await Application.findAll({
      limit: 5,
      order: [["created_at", "DESC"]],
      include: [
        {
          model: Job,
          as: "job",
          where: { posted_by: req.user.user_id },
          include: [
            {
              model: User,
              as: "poster",
              attributes: ["first_name", "last_name"],
            },
          ],
        },
        {
          model: Engineer,
          as: "applicant",
          include: [
            {
              model: User,
              as: "user",
              attributes: ["first_name", "last_name", "email"],
            },
          ],
        },
      ],
    });

    /* ===============================
       RECENT JOBS
       =============================== */
    const recentJobs = await Job.findAll({
      where: { posted_by: req.user.user_id },
      limit: 3,
      order: [["created_at", "DESC"]],
    });

    res.json({
      success: true,
      data: {
        projectManager,
        statistics: {
          activeProjectsCount: activeProjects.length,
          totalApplicationsCount,
          totalJobsCount,
          activeJobsCount,
          totalProjectsCount,
          successRate: `${successRate}%`,
          successRateChange: `${successRateChange >= 0 ? "+" : "-"}${successRateChange}%`,
        },
        recentApplications,
        recentJobs,
        activeProjects,
      },
    });
  } catch (error) {
    console.error("Failed to get dashboard data:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get dashboard data",
      error: error.message,
    });
  }
};

// Update project manager profile
const updateProfile = async (req, res) => {
  try {
    const projectManager = await ProjectManager.findOne({
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

    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: "Project manager profile not found",
      });
    }

    const allowedProjectManagerUpdates = [
      "company",
      "company_size", // not supported in DB yet
      "industry", // not supported in DB yet
      "bio",
    ];
    
    const allowedUserUpdates = [
      "first_name",
      "last_name",
      "phone_number",
      "city",
      "country",
      "website_url",
      "linkedin_url",
      // avatar_object_name is set only by upload below
    ];

    const pmUpdates = {};
    allowedProjectManagerUpdates.forEach((field) => {
      if (req.body[field] !== undefined) pmUpdates[field] = req.body[field];
    });

    const userUpdates = {};
    allowedUserUpdates.forEach((field) => {
      if (req.body[field] !== undefined) userUpdates[field] = req.body[field];
    });

    // keep old avatar so we can delete after successful update
    const oldAvatarObjectName = projectManager.user?.avatar_object_name || null;

    // handle avatar upload if present (route should use upload.single('avatar'))
    let newAvatarObjectName = null;
    if (req.file) {
      const { objectName } = await uploadToGCP(
        req.file,
        req.user.user_id,
        "profile-images",
      );
      newAvatarObjectName = objectName;
      userUpdates.avatar_object_name = objectName; // store ONLY the GCS path
    }

    // persist changes
    if (Object.keys(pmUpdates).length) await projectManager.update(pmUpdates);
    if (Object.keys(userUpdates).length)
      await projectManager.user.update(userUpdates);

    // delete old avatar only after DB points to the new one
    if (
      req.file &&
      oldAvatarObjectName &&
      oldAvatarObjectName !== newAvatarObjectName
    ) {
      try {
        await deleteFromGCP(oldAvatarObjectName);
      } catch (e) {
        console.warn("Failed to delete old PM avatar:", e?.message || e);
      }
    }

    // re-fetch and return a fresh signed URL
    const fresh = await ProjectManager.findOne({
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
      include: [{ model: ProjectManager, as: "project_manager" }],
    });

    // Format user response with signed URLs
    const formattedUser = await formatUserResponse(userWithAssociations);

    // Generate tokens
    // const { token, refreshToken } = generateTokens({
    //   user_id: req.user.user_id,
    //   role: userWithAssociations.role,
    // });

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        user: formattedUser,
        // token,
        // refreshToken,
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

// Create new job posting
const createJob = async (req, res) => {
  try {
    const {
      title,
      company,
      location,
      description,
      employment_type,
      salary,
      duration,
      openings,
      experience_level,
      skills_required,
      requirements,
      responsibilities,
      deadline,
    } = req.body;

    const job = await Job.create({
      posted_by: req.user.user_id,
      title,
      company,
      location,
      description,
      employment_type,
      salary,
      duration,
      openings,
      experience_level,
      skills_required,
      requirements,
      responsibilities,
      deadline,
      status: "active",
    });

    res.status(201).json({
      success: true,
      message: "Job created successfully",
      data: job,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Job creation failed",
      error: error.message,
    });
  }
};

// Get specific project manager's job postings
const getJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = { posted_by: req.user.user_id };
    if (status) {
      where.status = status;
    }

    const jobs = await Job.findAndCountAll({
      where,
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

// Get project manager's projects - list
const getPmProjects = async (req, res) => {
  try {
    const { page, limit, status } = req.query;

    // 1) Get PM profile
    const pm = await ProjectManager.findOne({
      where: { user_id: req.user.user_id },
    });

    if (!pm) {
      return res.status(404).json({
        success: false,
        message: "Project manager profile not found",
      });
    }

    // 2) Build WHERE on Project (THIS is the real fix)
    const where = {
      [Op.or]: [
        { project_managers_id: pm.project_managers_id }, // PM-owned
        { project_managers_id: null },                   // unassigned
      ],
    };

    if (status) where.status = status;

    const pagination = {
      limit: limit ? parseInt(limit) : undefined,
      offset: page && limit ? (parseInt(page) - 1) * parseInt(limit) : undefined,
    };

    const projects = await Project.findAndCountAll({
      where, // ✅ filter applied to Project rows (no leakage)
      include: [
        {
          model: ProjectManager,
          as: "project_manager",
          required: false,
          include: [{ model: User, as: "user" }],
        },
        {
          model: Engineer,
          as: "engineers",
          through: { attributes: [] },
          required: false,
          include: [
            {
              model: User,
              as: "user",
              attributes: ["first_name", "last_name"],
            },
          ],
        },
      ],
      ...pagination,
      order: [["created_at", "DESC"]],
      distinct: true,
    });

    // (Optional) flag unassigned projects for the frontend
    const rows = projects.rows.map((p) => ({
      ...p.toJSON(),
      is_unassigned: p.project_managers_id === null,
    }));

    return res.json({
      success: true,
      data: {
        projects: rows,
        pagination: {
          currentPage: page ? parseInt(page) : undefined,
          totalPages: limit ? Math.ceil(projects.count / parseInt(limit)) : undefined,
          totalItems: projects.count,
          itemsPerPage: limit ? parseInt(limit) : undefined,
        },
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


module.exports = {
  getDashboard,
  updateProfile,
  createJob,
  getJobs,
  getPmProjects,
};
