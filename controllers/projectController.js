const { Project, User, Job, ProjectManager, Engineer } = require('../models');
const { Op } = require('sequelize');
const { createNotification } = require('../utils/notificationUtil');

// Get all projects with filtering and pagination
const getProjects = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      priority,
      project_manager_id,
      engineer_id
    } = req.query;
    
    const offset = (page - 1) * limit;
    let where = {};

    // Apply filters
    if (status) {
      where.status = status;
    }
    
    if (priority) {
      where.priority = priority;
    }
    
    if (project_manager_id) {
      where.project_managers_user_id = project_manager_id;
    }
    
    if (engineer_id) {
      where.engineer_user_id = engineer_id;
    }

    const projects = await Project.findAndCountAll({
      where,
      include: [
        {
          model: User,
          as: 'engineer',
          attributes: ['first_name', 'last_name', 'email'],
          include: [{
            model: Engineer,
            as: 'engineer',
            attributes: ['specialization', 'years_of_experience']
          }]
        },
        {
          model: Job,
          as: 'job',
          attributes: ['title', 'company']
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']],
      distinct: true
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

// Get project by ID
const getProjectById = async (req, res) => {
  try {
    const { projects_id } = req.params;

    const project = await Project.findOne({
      where: { projects_id },
      include: [
        {
          model: User,
          as: 'engineer',
          attributes: ['first_name', 'last_name', 'email', 'phone_number'],
          include: [{
            model: Engineer,
            as: 'engineer'
          }]
        },
        {
          model: Job,
          as: 'job',
          include: [{
            model: User,
            as: 'poster',
            attributes: ['first_name', 'last_name'],
            include: [{
              model: ProjectManager,
              as: 'project_manager',
              attributes: ['company']
            }]
          }]
        }
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

// Create new project
const createProject = async (req, res) => {
  try {
    const {
      title,
      description,
      job_id,
      status = 'planning',
      priority = 'medium',
      progress = 0,
      team = [],
      tasks = [],
      start_date,
      deadline,
      feedback
    } = req.body;

    // Verify job exists if provided
    if (job_id) {
      const job = await Job.findByPk(job_id);
      if (!job) {
        return res.status(404).json({
          success: false,
          message: 'Job not found'
        });
      }
    }

    const project = await Project.create({
      project_managers_user_id: req.user.user_id,
      title,
      description,
      job_id,
      engineer_user_id,
      status,
      priority,
      progress,
      team,
      tasks,
      start_date,
      deadline,
      feedback
    });

    // Create notification for assigned engineer
    // if (engineer_user_id) {
    //   await createNotification({
    //     user_id: engineer_user_id,
    //     title: 'New Project Assignment',
    //     message: `You have been assigned to project: ${title}`,
    //     type: 'info',
    //     action_url: `/projects/${project.projects_id}`,
    //     metadata: {
    //       project_id: project.projects_id,
    //       project_manager_id: req.user.user_id
    //     }
    //   });
    // }

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

// Update project
const updateProject = async (req, res) => {
  try {
    const { projects_id } = req.params;
    const updates = req.body;

    const project = await Project.findOne({
      where: { projects_id },
      include: [{
        model: User,
        as: 'engineer',
        attributes: ['first_name', 'last_name']
      }]
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check permissions
    if (req.user.role === 'project_manager' && project.project_managers_user_id !== req.user.user_id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this project'
      });
    }

    const oldStatus = project.status;
    const oldProgress = project.progress;

    await project.update(updates);

    // Create notifications for significant changes
    if (project.engineer_user_id) {
      if (oldStatus !== updates.status && updates.status) {
        await createNotification({
          user_id: project.engineer_user_id,
          title: 'Project Status Updated',
          message: `Project "${project.title}" status changed to ${updates.status}`,
          type: 'info',
          action_url: `/projects/${projects_id}`,
          metadata: {
            project_id: projects_id,
            old_status: oldStatus,
            new_status: updates.status
          }
        });
      }

      if (updates.progress && updates.progress !== oldProgress && updates.progress % 25 === 0) {
        await createNotification({
          user_id: project.engineer_user_id,
          title: 'Project Milestone',
          message: `Project "${project.title}" is now ${updates.progress}% complete`,
          type: 'success',
          action_url: `/projects/${projects_id}`,
          metadata: {
            project_id: projects_id,
            progress: updates.progress
          }
        });
      }
    }

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
    const { projects_id } = req.params;

    const project = await Project.findByPk(projects_id);
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Project not found'
      });
    }

    // Check permissions
    if (req.user.role === 'project_manager' && project.project_managers_user_id !== req.user.user_id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this project'
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

// Get project statistics
const getProjectStats = async (req, res) => {
  try {
    const totalProjects = await Project.count();
    const planningProjects = await Project.count({ where: { status: 'planning' } });
    const inProgressProjects = await Project.count({ where: { status: 'in_progress' } });
    const completedProjects = await Project.count({ where: { status: 'completed' } });
    const onHoldProjects = await Project.count({ where: { status: 'on_hold' } });
    const cancelledProjects = await Project.count({ where: { status: 'cancelled' } });

    // Get projects by status
    const statusStats = await Project.findAll({
      attributes: [
        'status',
        [Project.sequelize.fn('COUNT', Project.sequelize.col('status')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // Get projects by priority
    const priorityStats = await Project.findAll({
      attributes: [
        'priority',
        [Project.sequelize.fn('COUNT', Project.sequelize.col('priority')), 'count']
      ],
      group: ['priority'],
      raw: true
    });

    // Get average progress
    const avgProgress = await Project.findOne({
      attributes: [
        [Project.sequelize.fn('AVG', Project.sequelize.col('progress')), 'average_progress']
      ],
      raw: true
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
          averageProgress: Math.round(avgProgress.average_progress || 0)
        },
        statusStats,
        priorityStats
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get project statistics',
      error: error.message
    });
  }
};

module.exports = {
  getProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats
};