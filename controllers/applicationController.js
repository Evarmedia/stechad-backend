const { Application, Job, User, Engineer, ProjectManager } = require('../models');
const { Op } = require('sequelize');
const { createNotification } = require('../utils/notificationUtil');

// Get all applications with filtering and pagination
const getApplications = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      job_id,
      engineer_id
    } = req.query;
    
    const offset = (page - 1) * limit;
    let where = {};

    // Apply filters
    if (status) {
      where.status = status;
    }
    
    if (job_id) {
      where.job_id = job_id;
    }
    
    if (engineer_id) {
      where.engineer_id = engineer_id;
    }

    const applications = await Application.findAndCountAll({
      where,
      include: [
        {
          model: Job,
          as: 'job',
          attributes: ['title', 'company', 'location'],
          include: [{
            model: User,
            as: 'poster',
            attributes: ['first_name', 'last_name']
          }]
        },
        {
          model: User,
          as: 'applicant',
          attributes: ['first_name', 'last_name', 'email'],
          include: [{
            model: Engineer,
            as: 'engineer',
            attributes: ['specialization', 'years_of_experience', 'skill_level']
          }]
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['applied_at', 'DESC']],
      distinct: true
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

// Get application by ID
const getApplicationById = async (req, res) => {
  try {
    const { applications_id } = req.params;

    const application = await Application.findOne({
      where: { applications_id },
      include: [
        {
          model: Job,
          as: 'job',
          include: [{
            model: User,
            as: 'poster',
            attributes: ['first_name', 'last_name', 'email'],
            include: [{
              model: ProjectManager,
              as: 'project_manager',
              attributes: ['company']
            }]
          }]
        },
        {
          model: User,
          as: 'applicant',
          attributes: ['first_name', 'last_name', 'email', 'phone_number'],
          include: [{
            model: Engineer,
            as: 'engineer'
          }]
        }
      ]
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    res.json({
      success: true,
      data: application
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get application details',
      error: error.message
    });
  }
};

// Update application status
const updateApplicationStatus = async (req, res) => {
  try {
    const { applications_id } = req.params;
    const { status, feedback } = req.body;

    const application = await Application.findOne({
      where: { applications_id },
      include: [
        {
          model: Job,
          as: 'job',
          include: [{
            model: User,
            as: 'poster'
          }]
        },
        {
          model: User,
          as: 'applicant'
        }
      ]
    });

    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    // Check if user has permission to update this application
    if (req.user.role === 'project_manager' && application.job.posted_by !== req.user.user_id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this application'
      });
    }

    const oldStatus = application.status;
    await application.update({
      status,
      feedback,
      reviewed_at: new Date(),
      reviewed_by: req.user.user_id
    });

    // Create notification for status change
    if (oldStatus !== status) {
      await createNotification({
        user_id: application.engineer_id,
        title: 'Application Status Updated',
        message: `Your application for "${application.job.title}" has been ${status}`,
        type: status === 'accepted' ? 'success' : status === 'rejected' ? 'warning' : 'info',
        action_url: `/applications/${applications_id}`,
        metadata: {
          application_id: applications_id,
          job_id: application.job_id,
          old_status: oldStatus,
          new_status: status
        }
      });
    }

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

// Get application statistics
const getApplicationStats = async (req, res) => {
  try {
    const totalApplications = await Application.count();
    const pendingApplications = await Application.count({ where: { status: 'pending' } });
    const reviewedApplications = await Application.count({ where: { status: 'reviewed' } });
    const acceptedApplications = await Application.count({ where: { status: 'accepted' } });
    const rejectedApplications = await Application.count({ where: { status: 'rejected' } });

    // Get applications by status
    const statusStats = await Application.findAll({
      attributes: [
        'status',
        [Application.sequelize.fn('COUNT', Application.sequelize.col('status')), 'count']
      ],
      group: ['status'],
      raw: true
    });

    // Get recent applications
    const recentApplications = await Application.findAll({
      limit: 10,
      order: [['applied_at', 'DESC']],
      include: [
        {
          model: Job,
          as: 'job',
          attributes: ['title']
        },
        {
          model: User,
          as: 'applicant',
          attributes: ['first_name', 'last_name']
        }
      ]
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalApplications,
          pendingApplications,
          reviewedApplications,
          acceptedApplications,
          rejectedApplications
        },
        statusStats,
        recentApplications
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get application statistics',
      error: error.message
    });
  }
};

// Delete application (admin only)
const deleteApplication = async (req, res) => {
  try {
    const { applications_id } = req.params;

    const application = await Application.findByPk(applications_id);
    if (!application) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    await application.destroy();

    res.json({
      success: true,
      message: 'Application deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete application',
      error: error.message
    });
  }
};

module.exports = {
  getApplications,
  getApplicationById,
  updateApplicationStatus,
  getApplicationStats,
  deleteApplication
};