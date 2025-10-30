const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Analytics
 *   description: Platform analytics and reporting endpoints (Admin only)
 */

const { authenticate, authorize } = require('../middleware/auth');
const {
  getUserAnalytics,
  getJobAnalytics,
  getApplicationAnalytics,
  getPlatformAnalytics
} = require('../controllers/analyticsController');

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticate, authorize('admin'));

/**
 * @swagger
 * /analytics/users:
 *   get:
 *     summary: Get user analytics data
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month, quarter, year]
 *           default: month
 *         description: Time period for analytics
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Start date for custom period
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *         description: End date for custom period
 *     responses:
 *       200:
 *         description: User analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_users:
 *                       type: integer
 *                       example: 1250
 *                     new_users:
 *                       type: integer
 *                       example: 45
 *                     active_users:
 *                       type: integer
 *                       example: 890
 *                     user_growth:
 *                       type: number
 *                       format: decimal
 *                       example: 12.5
 *                     role_distribution:
 *                       type: object
 *                       properties:
 *                         engineers:
 *                           type: integer
 *                           example: 800
 *                         project_managers:
 *                           type: integer
 *                           example: 400
 *                         admins:
 *                           type: integer
 *                           example: 50
 *                     registration_trends:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           date:
 *                             type: string
 *                             format: date
 *                           count:
 *                             type: integer
 */
router.get('/users', getUserAnalytics);

/**
 * @swagger
 * /analytics/jobs:
 *   get:
 *     summary: Get job posting analytics data
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month, quarter, year]
 *           default: month
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Job analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_jobs:
 *                       type: integer
 *                       example: 450
 *                     active_jobs:
 *                       type: integer
 *                       example: 120
 *                     completed_jobs:
 *                       type: integer
 *                       example: 280
 *                     average_budget:
 *                       type: number
 *                       format: decimal
 *                       example: 5500.00
 *                     job_types:
 *                       type: object
 *                       properties:
 *                         contract:
 *                           type: integer
 *                         freelance:
 *                           type: integer
 *                         full_time:
 *                           type: integer
 *                         part_time:
 *                           type: integer
 *                     popular_skills:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           skill:
 *                             type: string
 *                           count:
 *                             type: integer
 */
router.get('/jobs', getJobAnalytics);

/**
 * @swagger
 * /analytics/applications:
 *   get:
 *     summary: Get application analytics data
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month, quarter, year]
 *           default: month
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Application analytics data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     total_applications:
 *                       type: integer
 *                       example: 2500
 *                     pending_applications:
 *                       type: integer
 *                       example: 150
 *                     hired_applications:
 *                       type: integer
 *                       example: 320
 *                     rejection_rate:
 *                       type: number
 *                       format: decimal
 *                       example: 65.5
 *                     average_response_time:
 *                       type: number
 *                       format: decimal
 *                       example: 2.5
 *                     application_trends:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           date:
 *                             type: string
 *                             format: date
 *                           count:
 *                             type: integer
 */
router.get('/applications', getApplicationAnalytics);

/**
 * @swagger
 * /analytics/platform:
 *   get:
 *     summary: Get overall platform metrics and KPIs
 *     tags: [Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [day, week, month, quarter, year]
 *           default: month
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Platform metrics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     revenue:
 *                       type: number
 *                       format: decimal
 *                       example: 125000.00
 *                     commission_earned:
 *                       type: number
 *                       format: decimal
 *                       example: 12500.00
 *                     successful_matches:
 *                       type: integer
 *                       example: 320
 *                     platform_growth:
 *                       type: number
 *                       format: decimal
 *                       example: 15.2
 *                     user_satisfaction:
 *                       type: number
 *                       format: decimal
 *                       example: 4.6
 *                     top_performing_engineers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           engineer_id:
 *                             type: integer
 *                           name:
 *                             type: string
 *                           projects_completed:
 *                             type: integer
 *                           rating:
 *                             type: number
 *                             format: decimal
 */
router.get('/platform', getPlatformAnalytics);

module.exports = router;