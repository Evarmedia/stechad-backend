const { User, Engineer, Job, Application, Project } = require('../models');
const { Op } = require('sequelize');

// Complete engineer onboarding
const completeOnboarding = async (req, res) => {
  try {
    const {
      skills,
      experience_years,
      bio,
      portfolio_url,
      github_url,
      linkedin_url,
      hourly_rate,
      location,
      timezone
    } = req.body;

    const engineer = await Engineer.findOne({ where: { user_id: req.user.id } });
    
    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: 'Engineer profile not found'
      });
    }

    await engineer.update({
      skills,
      experience_years,
      bio,
      portfolio_url,
      github_url,
      linkedin_url,
      hourly_rate,
      location,
      timezone,
      onboarding_completed: true
    });

    res.json({
      success: true,
      message: 'Onboarding completed successfully',
      data: engineer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Onboarding failed',
      error: error.message
    });
  }
};

// Get engineer dashboard
const getDashboard = async (req, res) => {
  try {
    const engineer = await Engineer.findOne({
      where: { user_id: req.user.id },
      include: [{ model: User, as: 'user' }]
    });

    // Get statistics
    const totalApplications = await Application.count({
      where: { engineer_id: req.user.id }
    });

    const activeProjects = await Project.count({
      where: {
        engineer_id: req.user.id,
        status: ['planning', 'in_progress', 'review']
      }
    });

    const completedProjects = await Project.count({
      where: {
        engineer_id: req.user.id,
        status: 'completed'
      }
    });

    // Get recent applications
    const recentApplications = await Application.findAll({
      where: { engineer_id: req.user.id },
      include: [{ model: Job, as: 'job' }],
      limit: 5,
      order: [['created_at', 'DESC']]
    });

    const dashboardData = {
      engineer,
      statistics: {
        totalApplications,
        activeProjects,
        completedProjects,
        rating: engineer.rating
      },
      recentApplications
    };

    res.json({
      success: true,
      data: dashboardData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard data',
      error: error.message
    });
  }
};

// Get engineer profile
const getProfile = async (req, res) => {
  try {
    const engineer = await Engineer.findOne({
      where: { user_id: req.user.id },
      include: [{ model: User, as: 'user' }]
    });

    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: 'Engineer profile not found'
      });
    }

    res.json({
      success: true,
      data: engineer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error: error.message
    });
  }
};

// Update engineer profile
const updateProfile = async (req, res) => {
  try {
    const engineer = await Engineer.findOne({ where: { user_id: req.user.id } });
    
    if (!engineer) {
      return res.status(404).json({
        success: false,
        message: 'Engineer profile not found'
      });
    }

    const allowedUpdates = [
      'skills', 'experience_years', 'bio', 'portfolio_url', 'github_url',
      'linkedin_url', 'availability', 'hourly_rate', 'location', 'timezone'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    await engineer.update(updates);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: engineer
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Profile update failed',
      error: error.message
    });
  }
};

// Get available jobs
const getJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10, skills, experience_level, job_type, budget_min, budget_max } = req.query;
    const offset = (page - 1) * limit;

    const where = {
      status: 'open'
    };

    if (skills) {
      where.skills_required = {
        [Op.like]: `%${skills}%`
      };
    }

    if (experience_level) {
      where.experience_level = experience_level;
    }

    if (job_type) {
      where.job_type = job_type;
    }

    if (budget_min) {
      where.budget_min = { [Op.gte]: budget_min };
    }

    if (budget_max) {
      where.budget_max = { [Op.lte]: budget_max };
    }

    const jobs = await Job.findAndCountAll({
      where,
      include: [{ model: User, as: 'poster', attributes: ['first_name', 'last_name'] }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
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

// Get specific job details
const getJobDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const job = await Job.findOne({
      where: { id, status: 'open' },
      include: [{ model: User, as: 'poster', attributes: ['first_name', 'last_name'] }]
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Increment view count
    await job.increment('views_count');

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

// Apply for a job
const applyForJob = async (req, res) => {
  try {
    const { id } = req.params;
    const { cover_letter, proposed_rate, availability } = req.body;

    // Check if job exists and is open
    const job = await Job.findOne({
      where: { id, status: 'open' }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or no longer available'
      });
    }

    // Check if engineer already applied
    const existingApplication = await Application.findOne({
      where: { job_id: id, engineer_id: req.user.id }
    });

    if (existingApplication) {
      return res.status(400).json({
        success: false,
        message: 'You have already applied for this job'
      });
    }

    // Create application
    const application = await Application.create({
      job_id: id,
      engineer_id: req.user.id,
      cover_letter,
      proposed_rate,
      availability
    });

    // Update job applications count
    await job.increment('applications_count');

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: application
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Application failed',
      error: error.message
    });
  }
};

// Get engineer's applications
const getApplications = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = { engineer_id: req.user.id };
    if (status) {
      where.status = status;
    }

    const applications = await Application.findAndCountAll({
      where,
      include: [{ model: Job, as: 'job' }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        applications: applications.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(applications.count / limit),
          totalItems: applications.count,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get applications',
      error: error.message
    });
  }
};

// Update application status (withdraw)
const updateApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const application = await Application.findOne({
      where: { id, engineer_id: req.user.id }
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Engineer can only withdraw their application
    if (status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'You can only withdraw your application'
      });
    }

    await application.update({ status });

    res.json({
      success: true,
      message: 'Application updated successfully',
      data: application
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update application',
      error: error.message
    });
  }
};

// Get engineer's projects
const getProjects = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = { engineer_id: req.user.id };
    if (status) {
      where.status = status;
    }

    const projects = await Project.findAndCountAll({
      where,
      include: [{ model: User, as: 'client', attributes: ['first_name', 'last_name'] }],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
    });

    res.json({
      success: true,
      data: {
        projects: projects.rows,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(projects.count / limit),
          totalItems: projects.count,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get projects',
      error: error.message
    });
  }
};

// Get specific project details
const getProjectDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const project = await Project.findOne({
      where: { id, engineer_id: req.user.id },
      include: [
        { model: User, as: 'client', attributes: ['first_name', 'last_name'] },
        { model: Job, as: 'job' }
      ]
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    res.json({
      success: true,
      data: project
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get project details',
      error: error.message
    });
  }
};

module.exports = {
  completeOnboarding,
  getDashboard,
  getProfile,
  updateProfile,
  getJobs,
  getJobDetails,
  applyForJob,
  getApplications,
  updateApplication,
  getProjects,
  getProjectDetails
};