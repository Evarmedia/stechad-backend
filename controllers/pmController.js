const { User, ProjectManager, Job, Application, Project } = require('../models');
const { Op } = require('sequelize');

// Get project manager dashboard
const getDashboard = async (req, res) => {
  try {
    const projectManager = await ProjectManager.findOne({
      where: { user_id: req.user.id },
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
      where: { posted_by: req.user.id }
    });

    const activeJobs = await Job.count({
      where: {
        posted_by: req.user.id,
        status: 'open'
      }
    });

    const totalApplications = await Application.count({
      include: [{
        model: Job,
        as: 'job',
        where: { posted_by: req.user.id }
      }]
    });

    const activeProjects = await Project.count({
      where: {
        client_id: req.user.id,
        status: ['planning', 'in_progress', 'review']
      }
    });

    const completedProjects = await Project.count({
      where: {
        client_id: req.user.id,
        status: 'completed'
      }
    });

    // Get recent applications
    const recentApplications = await Application.findAll({
      include: [{
        model: Job,
        as: 'job',
        where: { posted_by: req.user.id },
        include: [{ model: User, as: 'poster', attributes: ['first_name', 'last_name'] }]
      }, {
        model: User,
        as: 'engineer',
        attributes: ['first_name', 'last_name', 'email']
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

// Get project manager profile
const getProfile = async (req, res) => {
  try {
    const projectManager = await ProjectManager.findOne({
      where: { user_id: req.user.id },
      include: [{ model: User, as: 'user' }]
    });

    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: 'Project manager profile not found'
      });
    }

    res.json({
      success: true,
      data: projectManager
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get profile',
      error: error.message
    });
  }
};

// Update project manager profile
const updateProfile = async (req, res) => {
  try {
    const projectManager = await ProjectManager.findOne({ where: { user_id: req.user.id } });
    
    if (!projectManager) {
      return res.status(404).json({
        success: false,
        message: 'Project manager profile not found'
      });
    }

    const allowedUpdates = [
      'company_name', 'company_size', 'industry', 'bio', 'website_url',
      'linkedin_url', 'location', 'timezone'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    await projectManager.update(updates);

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
      description,
      requirements,
      skills_required,
      budget_min,
      budget_max,
      budget_type,
      duration,
      location,
      remote_allowed,
      experience_level,
      job_type,
      deadline
    } = req.body;

    const job = await Job.create({
      title,
      description,
      requirements,
      skills_required,
      budget_min,
      budget_max,
      budget_type,
      duration,
      location,
      remote_allowed,
      experience_level,
      job_type,
      deadline,
      posted_by: req.user.id,
      status: 'open'
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

// Get project manager's job postings
const getJobs = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = { posted_by: req.user.id };
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

// Update job posting
const updateJob = async (req, res) => {
  try {
    const { id } = req.params;

    const job = await Job.findOne({
      where: { id, posted_by: req.user.id }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const allowedUpdates = [
      'title', 'description', 'requirements', 'skills_required',
      'budget_min', 'budget_max', 'budget_type', 'duration',
      'location', 'remote_allowed', 'experience_level', 'job_type',
      'status', 'deadline'
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
    const { id } = req.params;

    const job = await Job.findOne({
      where: { id, posted_by: req.user.id }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if job has applications
    const applicationCount = await Application.count({
      where: { job_id: id }
    });

    if (applicationCount > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete job with existing applications'
      });
    }

    await job.destroy();

    res.json({
      success: true,
      message: 'Job deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Job deletion failed',
      error: error.message
    });
  }
};

// Get applicants for specific job
const getJobApplicants = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    // Verify job belongs to current PM
    const job = await Job.findOne({
      where: { id, posted_by: req.user.id }
    });

    if (!job) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const where = { job_id: id };
    if (status) {
      where.status = status;
    }

    const applications = await Application.findAndCountAll({
      where,
      include: [
        { 
          model: User, 
          as: 'engineer', 
          attributes: ['first_name', 'last_name', 'email'],
          include: [{ model: require('../models').Engineer, as: 'engineer' }]
        }
      ],
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
      message: 'Failed to get applicants',
      error: error.message
    });
  }
};

// Update application status
const updateApplicationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback } = req.body;

    const application = await Application.findOne({
      where: { id },
      include: [{
        model: Job,
        as: 'job',
        where: { posted_by: req.user.id }
      }]
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    await application.update({
      status,
      feedback,
      reviewed_at: new Date(),
      reviewed_by: req.user.id
    });

    res.json({
      success: true,
      message: 'Application status updated successfully',
      data: application
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to update application status',
      error: error.message
    });
  }
};

// Get project manager's projects
const getProjects = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    const offset = (page - 1) * limit;

    const where = { client_id: req.user.id };
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

// Create new project
const createProject = async (req, res) => {
  try {
    const {
      title,
      description,
      job_id,
      engineer_id,
      budget,
      start_date,
      end_date,
      milestones
    } = req.body;

    const project = await Project.create({
      title,
      description,
      job_id,
      client_id: req.user.id,
      engineer_id,
      budget,
      start_date,
      end_date,
      milestones,
      status: 'planning'
    });

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: project
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Project creation failed',
      error: error.message
    });
  }
};

// Update project details
const updateProject = async (req, res) => {
  try {
    const { id } = req.params;

    const project = await Project.findOne({
      where: { id, client_id: req.user.id }
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    const allowedUpdates = [
      'title', 'description', 'status', 'budget', 'start_date',
      'end_date', 'actual_end_date', 'progress', 'milestones',
      'deliverables', 'rating', 'feedback'
    ];

    const updates = {};
    allowedUpdates.forEach(field => {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    });

    await project.update(updates);

    res.json({
      success: true,
      message: 'Project updated successfully',
      data: project
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Project update failed',
      error: error.message
    });
  }
};

// Delete project
const deleteProject = async (req, res) => {
  try {
    const { id } = req.params;

    const project = await Project.findOne({
      where: { id, client_id: req.user.id }
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Only allow deletion if project is in planning or cancelled status
    if (!['planning', 'cancelled'].includes(project.status)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete project that is in progress or completed'
      });
    }

    await project.destroy();

    res.json({
      success: true,
      message: 'Project deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Project deletion failed',
      error: error.message
    });
  }
};

module.exports = {
  getDashboard,
  getProfile,
  updateProfile,
  createJob,
  getJobs,
  updateJob,
  deleteJob,
  getJobApplicants,
  updateApplicationStatus,
  getProjects,
  createProject,
  updateProject,
  deleteProject
};