const { User, Engineer, ProjectManager, Job, Application, Project } = require('../models');
const { Op } = require('sequelize');

// Get project manager dashboard
const getDashboard = async (req, res) => {
  try {
    const projectManager = await ProjectManager.findOne({
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: 'user' }]
    });

    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: 'Project manager profile not found'
      });
    }

    // Get statistics
    const totalJobs = await Job.count({
      where: { posted_by: req.user.user_id }
    });

    const activeJobs = await Job.count({
      where: {
        posted_by: req.user.user_id,
        status: 'active'
      }
    });

    const totalApplications = await Application.count({
      include: [{
        model: Job,
        as: 'job',
        where: { posted_by: req.user.user_id }
      }]
    });

    const activeProjects = await Project.count({
      where: {
        project_managers_user_id: req.user.user_id,
        status: ['planning', 'in_progress']
      }
    });

    const completedProjects = await Project.count({
      where: {
        project_managers_user_id: req.user.user_id,
        status: 'completed'
      }
    });

    // Get recent applications
    const recentApplications = await Application.findAll({
      include: [{
        model: Job,
        as: 'job',
        where: { posted_by: req.user.user_id },
        include: [{ model: User, as: 'poster', attributes: ['first_name', 'last_name'] }]
      }, {
        model: User,
        as: 'applicant',
        attributes: ['first_name', 'last_name', 'email'] // Might need more later
      }],
      limit: 5,
      order: [['created_at', 'DESC']]
    });

    const dashboardData = {
      projectManager,
      statistics: {
        totalJobs,
        activeJobs,
        totalApplications,
        activeProjects,
        completedProjects
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

// Update project manager profile
const updateProfile = async (req, res) => {
  try {
    const projectManager = await ProjectManager.findOne({ 
      where: { user_id: req.user.user_id },
      include: [{ model: User, as: 'user', attributes: { exclude: ['password', 'reset_password_token', 'reset_password_expires'] } }]
    });
    
    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: 'Project manager profile not found'
      });
    }

    const allowedProjectManagerUpdates = [
      'company_name', 'company_size', 'industry', 'bio', 'website_url',
      'linkedin_url', 'location', 'timezone'
    ];

    const allowedUserUpdates = [
      'first_name', 'last_name', 'phone_number', 'city', 'country', 'avatar_object_name'
    ];

    const projectManagerUpdates = {};
    allowedProjectManagerUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        projectManagerUpdates[field] = req.body[field];
      }
    });

    const userUpdates = {};
    allowedUserUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        userUpdates[field] = req.body[field];
      }
    });

    await projectManager.update(projectManagerUpdates);
    await projectManager.user.update(userUpdates);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: projectManager
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Profile update failed',
      error: error.message
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
      salary,
      duration,
      openings,
      employment_type,
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
      status: 'active'
    });

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      data: job
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Job creation failed',
      error: error.message
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

// Get project manager's projects
const getProjects = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = { project_managers_user_id: req.user.user_id };
    if (status) {
      where.status = status;
    }

    const projects = await Project.findAndCountAll({
      where,
      include: [
        { model: User, as: 'engineer', attributes: ['first_name', 'last_name'] },
        { model: Job, as: 'job', attributes: ['title'] }
      ],
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

module.exports = {
  getDashboard,
  updateProfile,
  createJob,
  getJobs,
  getProjects,
};