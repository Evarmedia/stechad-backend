const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Job management endpoints for viewing and searching job postings
 */

const { authenticate, authorize } = require('../middleware/auth');
const { getJobs, getJobById, getJobApplicants, getJobStats, updateJob, deleteJob } = require('../controllers/jobsController');

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
 * /jobs/{jobs_id}/applicants:
 *   get:
 *     summary: Get applicants for specific job
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: jobs_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
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
 *           enum: [pending, reviewed, shortlisted, rejected, accepted]
 *         description: Filter by application status
 *     responses:
 *       200:
 *         description: Applicants retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginationResponse'
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
router.get('/:jobs_id/applicants', authenticate, authorize('admin', 'project_manager'), getJobApplicants);

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

/**
 * @swagger
 * /update/{jobs_id}:
 *   put:
 *     summary: Update job posting
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: jobs_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
*     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - company
 *               - location
 *               - description
 *               - employment_type
 *               - salary
 *               - duration
 *               - openings
 *               - experience_level
 *               - skills_required
 *               - requirements
 *               - responsibilities
 *               - deadline
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Expert Rust Developer"
 *               company:
 *                 type: string
 *                 example: "Stechad ltd"
 *               location:
 *                 type: string
 *                 example: "remote"
 *               description:
 *                 type: string
 *                 example: "We are looking for an experienced Rust developer..."
 *               salary:
 *                 type: string
 *                 example: "200EUR"
 *               duration:
 *                 type: string
 *                 example: "6 months"
 *               openings:
 *                 type: number
 *                 example: "1"
 *               employment_type:
 *                 type: string
 *                 enum: ['full-time', 'contract', 'part-time']
 *                 example: "full-time"
 *               experience_level:
 *                 type: string
 *                 enum: [entry, intermediate, senior, expert]
 *                 example: "expert"
 *               skills_required:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["React", "TypeScript", "Node.js"]
 *               requirements:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["12+ years expert experience", "Rust proficiency"]
 *               responsibilities:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Build clean architecture", "Debug projects"]
 *               status:
 *                 type: string
 *                 enum: [draft, active, closed]
 *                 example: "draft"
 *               deadline:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-10-01T00:00:00Z"
 *     responses:
 *       200:
 *         description: Job updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
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
router.put('/update/:jobs_id', authenticate, authorize('admin', 'project_manager'), updateJob);

/**
 * @swagger
 * /jobs/{jobs_id}:
 *   delete:
 *     summary: Delete job posting
 *     tags: [Jobs]
 *     parameters:
 *       - in: path
 *         name: jobs_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.delete('/:jobs_id', authenticate, authorize('admin', 'project_manager'), deleteJob);

module.exports = router;