const { Notification } = require('../models');

/**
 * Create a new notification
 * @param {Object} notificationData - The notification data
 * @param {string} notificationData.user_id - The user ID to send notification to
 * @param {string} notificationData.title - The notification title
 * @param {string} notificationData.message - The notification message
 * @param {string} [notificationData.type='info'] - The notification type (info, success, warning)
 * @param {string} [notificationData.action_url] - Optional URL for action
 * @param {Object} [notificationData.metadata] - Optional metadata object
 * @returns {Promise<Object>} The created notification
 */
const createNotification = async ({
  user_id,
  title,
  message,
  type = 'info',
  action_url = null,
  metadata = {}
}) => {
  try {
    const notification = await Notification.create({
      user_id,
      title,
      message,
      type,
      action_url,
      metadata,
      is_read: false
    });

    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
};

/**
 * Create multiple notifications for different users
 * @param {Array} notifications - Array of notification objects
 * @returns {Promise<Array>} Array of created notifications
 */
const createBulkNotifications = async (notifications) => {
  try {
    const createdNotifications = await Notification.bulkCreate(
      notifications.map(notification => ({
        ...notification,
        type: notification.type || 'info',
        is_read: false,
        metadata: notification.metadata || {}
      }))
    );

    return createdNotifications;
  } catch (error) {
    console.error('Error creating bulk notifications:', error);
    throw error;
  }
};

/**
 * Mark notification as read
 * @param {string} notification_id - The notification ID
 * @param {string} user_id - The user ID (for security)
 * @returns {Promise<Object>} The updated notification
 */
const markAsRead = async (notification_id, user_id) => {
  try {
    const notification = await Notification.findOne({
      where: {
        notifications_id: notification_id,
        user_id: user_id
      }
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    await notification.update({
      is_read: true,
      read_at: new Date()
    });

    return notification;
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
};

/**
 * Mark all notifications as read for a user
 * @param {string} user_id - The user ID
 * @returns {Promise<number>} Number of updated notifications
 */
const markAllAsRead = async (user_id) => {
  try {
    const [updatedCount] = await Notification.update(
      {
        is_read: true,
        read_at: new Date()
      },
      {
        where: {
          user_id: user_id,
          is_read: false
        }
      }
    );

    return updatedCount;
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
};

/**
 * Get notifications for a user with pagination
 * @param {string} user_id - The user ID
 * @param {Object} options - Query options
 * @param {number} [options.page=1] - Page number
 * @param {number} [options.limit=20] - Items per page
 * @param {boolean} [options.is_read] - Filter by read status
 * @param {string} [options.type] - Filter by notification type
 * @returns {Promise<Object>} Paginated notifications
 */
const getUserNotifications = async (user_id, options = {}) => {
  try {
    const {
      page = 1,
      limit = 20,
      is_read,
      type
    } = options;

    const offset = (page - 1) * limit;
    let where = { user_id };

    if (is_read !== undefined) {
      where.is_read = is_read;
    }

    if (type) {
      where.type = type;
    }

    const notifications = await Notification.findAndCountAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
    });

    // Get unread count
    const unreadCount = await Notification.count({
      where: {
        user_id,
        is_read: false
      }
    });

    return {
      notifications: notifications.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(notifications.count / limit),
        totalItems: notifications.count,
        itemsPerPage: parseInt(limit)
      },
      unread_count: unreadCount
    };
  } catch (error) {
    console.error('Error getting user notifications:', error);
    throw error;
  }
};

/**
 * Delete old notifications (cleanup utility)
 * @param {number} daysOld - Delete notifications older than this many days
 * @returns {Promise<number>} Number of deleted notifications
 */
const deleteOldNotifications = async (daysOld = 30) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const deletedCount = await Notification.destroy({
      where: {
        created_at: {
          [require('sequelize').Op.lt]: cutoffDate
        },
        is_read: true
      }
    });

    return deletedCount;
  } catch (error) {
    console.error('Error deleting old notifications:', error);
    throw error;
  }
};

/**
 * Create notification for job application status change
 * @param {Object} application - The application object
 * @param {string} oldStatus - The previous status
 * @param {string} newStatus - The new status
 */
const createApplicationStatusNotification = async (application, oldStatus, newStatus) => {
  let type = 'info';
  let message = `Your application for "${application.job_title}" status has been updated to ${newStatus}`;

  switch (newStatus) {
    case 'accepted':
      type = 'success';
      message = `Congratulations! Your application for "${application.job_title}" has been accepted`;
      break;
    case 'rejected':
      type = 'warning';
      message = `Your application for "${application.job_title}" has been rejected`;
      break;
    case 'reviewed':
      type = 'info';
      message = `Your application for "${application.job_title}" is under review`;
      break;
  }

  return await createNotification({
    user_id: application.engineer_id,
    title: 'Application Status Update',
    message,
    type,
    action_url: `/applications/${application.applications_id}`,
    metadata: {
      application_id: application.applications_id,
      job_id: application.job_id,
      old_status: oldStatus,
      new_status: newStatus
    }
  });
};

/**
 * Create notification for new job posting
 * @param {Object} job - The job object
 * @param {Array} engineerIds - Array of engineer user IDs to notify
 */
const createNewJobNotification = async (job, engineerIds) => {
  const notifications = engineerIds.map(engineer_id => ({
    user_id: engineer_id,
    title: 'New Job Opportunity',
    message: `A new job "${job.title}" at ${job.company} matches your profile`,
    type: 'info',
    action_url: `/jobs/${job.jobs_id}`,
    metadata: {
      job_id: job.jobs_id,
      company: job.company,
      location: job.location
    }
  }));

  return await createBulkNotifications(notifications);
};

/**
 * Create notification for project assignment
 * @param {Object} project - The project object
 * @param {string} engineer_id - The engineer user ID
 */
const createProjectAssignmentNotification = async (project, engineer_id) => {
  return await createNotification({
    user_id: engineer_id,
    title: 'New Project Assignment',
    message: `You have been assigned to project: ${project.title}`,
    type: 'info',
    action_url: `/projects/${project.projects_id}`,
    metadata: {
      project_id: project.projects_id,
      project_manager_id: project.project_managers_user_id
    }
  });
};

module.exports = {
  createNotification,
  createBulkNotifications,
  markAsRead,
  markAllAsRead,
  getUserNotifications,
  deleteOldNotifications,
  createApplicationStatusNotification,
  createNewJobNotification,
  createProjectAssignmentNotification
};