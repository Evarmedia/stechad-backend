const { User, Job, Application, ProjectManager, Engineer } = require('../models');
const { Op } = require('sequelize');
const { getV4ReadSignedUrl } = require('../config/gcpStorage');
const { getRoleKey } = require('../utils/roleUtils');

const SIGNED_URL_TTL_SECONDS = 3600; // 1 hour

// Get all jobs with filtering and pagination
const getJobs = async (req, res) => {
  try {
    const {
      page,
      limit,
      status,
      location,
      employment_type,
      experience_level,
      skills,
      search
    } = req.query;

    let where = {};

    // Apply filters
    if (status) {
      where.status = status;
    }
    
    if (location) {
      where.location = { [Op.iLike]: `%${location}%` };
    }
    
    if (employment_type) {
      where.employment_type = employment_type;
    }
    
    if (experience_level) {
      where.experience_level = experience_level;
    }
    
    if (skills) {
      const skillsArray = skills?.split(',').map(skill => skill.trim());
      where.skills_required = { [Op.overlap]: skillsArray };
    }
    
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { company: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const pagination = {
      limit: limit ? parseInt(limit) : undefined,
      offset: page && limit ? (parseInt(page) - 1) * parseInt(limit) : undefined,
    };

    const jobs = await Job.findAndCountAll({
      where: Object.keys(where).length > 0 ? where : undefined,
      include: [
        {
          model: User,
          as: 'poster',
          attributes: ['first_name', 'last_name', 'email'],
          include: [{
            model: ProjectManager,
            as: 'project_manager',
            attributes: ['company']
          }]
        }
      ],
      ...pagination,
      order: [['posted_at', 'DESC']],
      distinct: true
    });

    res.json({
      success: true,
      data: {
        jobs: jobs.rows,
        pagination: {
          currentPage: page ? parseInt(page) : undefined,
          totalPages: limit ? Math.ceil(jobs.count / parseInt(limit)) : undefined,
          totalItems: jobs.count,
          itemsPerPage: limit ? parseInt(limit) : undefined
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get jobs',
      error: error.message
    });
  }
};

// Get job by ID
const getJobById = async (req, res) => {
  try {
    const { jobs_id } = req.params;

    const job = await Job.findOne({
      where: { jobs_id },
      include: [
        // 🔹 Job poster
        {
          model: User,
          as: "poster",
          attributes: ["first_name", "last_name", "email"],
          include: [
            {
              model: ProjectManager,
              as: "project_manager",
              attributes: ["company"],
            },
          ],
        },

        // 🔹 Applications
        {
          model: Application,
          as: "applications",
          attributes: ["applications_id", "status", "applied_at"],
          include: [
            {
              // 🔧 FIX: applicant is Engineer, not User
              model: Engineer,
              as: "applicant",
              include: [
                {
                  model: User,
                  as: "user",
                  attributes: ["first_name", "last_name"],
                },
              ],
            },
          ],
        },
      ],
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    return res.json({
      success: true,
      data: job,
    });
  } catch (error) {
    console.error("Failed to get job details:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get job details",
      error: error.message,
    });
  }
};

// Get applicants for specific job
const getJobApplicants = async (req, res) => {
  try {
    const { jobs_id } = req.params;
    const { page, limit, status } = req.query;

    const job = await Job.findOne({ where: { jobs_id } });
    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    const where = { job_id: jobs_id };
    if (status) where.status = status;

    const pagination = {
      limit: limit ? parseInt(limit) : undefined,
      offset:
        page && limit ? (parseInt(page) - 1) * parseInt(limit) : undefined,
    };

    const applications = await Application.findAndCountAll({
      where,

      include: [
        {
          // 🔧 FIX: applicant is Engineer, not User
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

      ...pagination,
      order: [["created_at", "DESC"]],
      distinct: true,
    });

    const applicationsWithUrls = await Promise.all(
      applications.rows.map(async (app) => {
        const data = app.toJSON();
        const engineer = data?.applicant;

        if (engineer) {
          engineer.cv_url = engineer.cv_object_name
            ? await getV4ReadSignedUrl(
                engineer.cv_object_name,
                SIGNED_URL_TTL_SECONDS
              )
            : null;
        }

        return data;
      })
    );

    return res.json({
      success: true,
      data: {
        applications: applicationsWithUrls,
        pagination: {
          currentPage: page ? parseInt(page) : undefined,
          totalPages: limit
            ? Math.ceil(applications.count / parseInt(limit))
            : undefined,
          totalItems: applications.count,
          itemsPerPage: limit ? parseInt(limit) : undefined,
        },
      },
    });
  } catch (error) {
    console.error("Failed to get applicants:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to get applicants",
      error: error.message,
    });
  }
};

// Get job statistics
const getJobStats = async (req, res) => {
  try {
    const totalJobs = await Job.count();
    const activeJobs = await Job.count({ where: { status: 'active' } });
    const closedJobs = await Job.count({ where: { status: 'closed' } });
    const draftJobs = await Job.count({ where: { status: 'draft' } });

    // Get jobs by employment type
    const employmentTypeStats = await Job.findAll({
      attributes: [
        'employment_type',
        [Job.sequelize.fn('COUNT', Job.sequelize.col('employment_type')), 'count']
      ],
      group: ['employment_type'],
      raw: true
    });

    // Get jobs by experience level
    const experienceLevelStats = await Job.findAll({
      attributes: [
        'experience_level',
        [Job.sequelize.fn('COUNT', Job.sequelize.col('experience_level')), 'count']
      ],
      group: ['experience_level'],
      raw: true
    });

    // Get recent jobs
    const recentJobs = await Job.findAll({
      limit: 5,
      order: [['created_at', 'DESC']],
      include: [{
        model: User,
        as: 'poster',
        attributes: ['first_name', 'last_name']
      }]
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalJobs,
          activeJobs,
          closedJobs,
          draftJobs
        },
        employmentTypeStats,
        experienceLevelStats,
        recentJobs
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get job statistics',
      error: error.message
    });
  }
};

// Update job posting
const updateJob = async (req, res) => {
  try {
    const { jobs_id } = req.params;

    const job = await Job.findOne({
      where: { jobs_id }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const allowedUpdates = [
      "title","company","location","description","salary","duration","openings","employment_type","experience_level","skills_required","requirements","responsibilities","deadline", "status"
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    await job.update(updates);

    res.json({
      success: true,
      message: 'Job updated successfully',
      data: job
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Job update failed',
      error: error.message
    });
  }
};

// Delete job posting
const deleteJob = async (req, res) => {
  try {
    const { jobs_id } = req.params;
    const userId = req.user.user_id;
    const userRole = getRoleKey(req.user);

    const job = await Job.findByPk(jobs_id, {
      include: [{ model: User, as: 'poster' }]
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: "Job not found",
      });
    }

    // Check if user is admin or the job poster
    const isAdmin = ['admin', 'super_admin'].includes(userRole);
    const isJobPoster = job.poster_id === userId;

    if (!isAdmin && !isJobPoster) {
      return res.status(403).json({
        success: false,
        message: "You don't have permission to delete this job",
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


module.exports = {
  getJobs,
  getJobById,
  getJobApplicants,
  getJobStats,
  updateJob,
  deleteJob
};
