const { User, Job, Application, ProjectManager } = require('../models');
const { Op } = require('sequelize');

// Get all jobs with filtering and pagination
const getJobs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      location,
      employment_type,
      experience_level,
      skills,
      search
    } = req.query;
    
    const offset = (page - 1) * limit;
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
      const skillsArray = skills.split(',').map(skill => skill.trim());
      where.skills_required = { [Op.overlap]: skillsArray };
    }
    
    if (search) {
      where[Op.or] = [
        { title: { [Op.iLike]: `%${search}%` } },
        { description: { [Op.iLike]: `%${search}%` } },
        { company: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const jobs = await Job.findAndCountAll({
      where,
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
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['posted_at', 'DESC']],
      distinct: true
    });

    res.json({
      success: true,
      data: {
        jobs: jobs.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(jobs.count / limit),
          totalItems: jobs.count,
          itemsPerPage: parseInt(limit)
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
        {
          model: User,
          as: 'poster',
          attributes: ['first_name', 'last_name', 'email'],
          include: [{
            model: ProjectManager,
            as: 'project_manager',
            attributes: ['company']
          }]
        },
        {
          model: Application,
          as: 'applications',
          attributes: ['applications_id', 'status', 'applied_at'],
          include: [{
            model: User,
            as: 'applicant',
            attributes: ['first_name', 'last_name']
          }]
        }
      ]
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    res.json({
      success: true,
      data: job
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get job details',
      error: error.message
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

module.exports = {
  getJobs,
  getJobById,
  getJobStats
};