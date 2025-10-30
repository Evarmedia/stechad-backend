const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Job management endpoints for viewing and searching job postings
 */

const { authenticate, authorize } = require('../middleware/auth');
const { getJobs, getJobById, getJobStats } = require('../controllers/jobsController');

const router = express.Router();

/**
 * @swagger
 * /jobs:
 *   get:
 *     summary: Get all jobs with filtering and pagination
 *     tags: [Jobs]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number for pagination
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *         description: Number of items per page
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, closed, draft]
 *         description: Filter by job status
 *       - in: query
 *         name: location
 *         schema:
 *           type: string
 *         description: Filter by location
 *       - in: query
 *         name: employment_type
 *         schema:
 *           type: string
 *           enum: [full-time, contract, part-time]
 *         description: Filter by employment type
 *       - in: query
 *         name: experience_level
 *         schema:
 *           type: string
 *           enum: [entry, intermediate, senior, expert]
 *         description: Filter by experience level
 *       - in: query
 *         name: skills
 *         schema:
 *           type: string
 *         description: Comma-separated list of skills
 *         example: "JavaScript,React,Node.js"
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search in title, description, and company
 *     responses:
 *       200:
 *         description: Jobs retrieved successfully
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
 *                     jobs:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Job'
 *                     pagination:
 *                       $ref: '#/components/schemas/PaginationInfo'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', getJobs);

/**
 * @swagger
 * /jobs/{jobs_id}:
 *   get:
 *     summary: Get job details by ID
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: jobs_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Job'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:jobs_id', getJobById);

/**
 * @swagger
 * /jobs/stats/overview:
 *   get:
 *     summary: Get job statistics and analytics
 *     tags: [Jobs]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Job statistics retrieved successfully
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
 *                     overview:
 *                       type: object
 *                       properties:
 *                         totalJobs:
 *                           type: integer
 *                           example: 150
 *                         activeJobs:
 *                           type: integer
 *                           example: 45
 *                         closedJobs:
 *                           type: integer
 *                           example: 95
 *                         draftJobs:
 *                           type: integer
 *                           example: 10
 *                     employmentTypeStats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           employment_type:
 *                             type: string
 *                           count:
 *                             type: integer
 *                     experienceLevelStats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           experience_level:
 *                             type: string
 *                           count:
 *                             type: integer
 *                     recentJobs:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Job'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/stats/overview', authenticate, authorize('admin', 'project_manager'), getJobStats);

module.exports = router;