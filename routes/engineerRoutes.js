const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Engineers
 *   description: Engineer-specific endpoints for profile management, job applications, and projects
 */

const {
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
} = require('../controllers/engineerController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateApplication } = require('../middleware/validation');

const router = express.Router();

// All routes require authentication and engineer role
router.use(authenticate, authorize('engineer'));

/**
 * @swagger
 * /engineers/onboarding:
 *   post:
 *     summary: Complete engineer onboarding process
 *     tags: [Engineers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["JavaScript", "React", "Node.js"]
 *               experience_years:
 *                 type: integer
 *                 example: 5
 *               bio:
 *                 type: string
 *                 example: "Experienced full-stack developer with expertise in modern web technologies"
 *               portfolio_url:
 *                 type: string
 *                 example: "https://johndoe.dev"
 *               github_url:
 *                 type: string
 *                 example: "https://github.com/johndoe"
 *               linkedin_url:
 *                 type: string
 *                 example: "https://linkedin.com/in/johndoe"
 *               hourly_rate:
 *                 type: number
 *                 format: decimal
 *                 example: 75.00
 *               location:
 *                 type: string
 *                 example: "New York, NY"
 *               timezone:
 *                 type: string
 *                 example: "America/New_York"
 *     responses:
 *       200:
 *         description: Onboarding completed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Onboarding completed successfully
 *                 data:
 *                   $ref: '#/components/schemas/Engineer'
 *       404:
 *         description: Engineer profile not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Onboarding failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/onboarding', completeOnboarding);

/**
 * @swagger
 * /engineers/dashboard:
 *   get:
 *     summary: Get engineer dashboard data with statistics and recent activities
 *     tags: [Engineers]
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
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
 *                     engineer:
 *                       $ref: '#/components/schemas/Engineer'
 *                     statistics:
 *                       type: object
 *                       properties:
 *                         totalApplications:
 *                           type: integer
 *                           example: 25
 *                         activeProjects:
 *                           type: integer
 *                           example: 3
 *                         completedProjects:
 *                           type: integer
 *                           example: 12
 *                         rating:
 *                           type: number
 *                           format: decimal
 *                           example: 4.5
 *                     recentApplications:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Application'
 *       500:
 *         description: Failed to get dashboard data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/dashboard', getDashboard);

/**
 * @swagger
 * /engineers/profile:
 *   get:
 *     summary: Get engineer profile details
 *     tags: [Engineers]
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Engineer'
 *       404:
 *         description: Engineer profile not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to get profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/profile', getProfile);

/**
 * @swagger
 * /engineers/profile:
 *   put:
 *     summary: Update engineer profile
 *     tags: [Engineers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["JavaScript", "React", "Node.js", "Python"]
 *               experience_years:
 *                 type: integer
 *                 example: 6
 *               bio:
 *                 type: string
 *                 example: "Updated bio with new skills and experience"
 *               portfolio_url:
 *                 type: string
 *                 example: "https://updated-portfolio.com"
 *               github_url:
 *                 type: string
 *                 example: "https://github.com/johndoe"
 *               linkedin_url:
 *                 type: string
 *                 example: "https://linkedin.com/in/johndoe"
 *               availability:
 *                 type: string
 *                 enum: [available, busy, unavailable]
 *                 example: available
 *               hourly_rate:
 *                 type: number
 *                 format: decimal
 *                 example: 85.00
 *               location:
 *                 type: string
 *                 example: "San Francisco, CA"
 *               timezone:
 *                 type: string
 *                 example: "America/Los_Angeles"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Profile updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/Engineer'
 *       404:
 *         description: Engineer profile not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Profile update failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/profile', updateProfile);

/**
 * @swagger
 * /engineers/jobs:
 *   get:
 *     summary: Get available jobs for engineers with filtering and pagination
 *     tags: [Engineers]
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
 *         name: skills
 *         schema:
 *           type: string
 *         description: Filter by required skills
 *         example: JavaScript
 *       - in: query
 *         name: experience_level
 *         schema:
 *           type: string
 *           enum: [entry, intermediate, senior, expert]
 *         description: Filter by experience level
 *       - in: query
 *         name: job_type
 *         schema:
 *           type: string
 *           enum: [full_time, part_time, contract, freelance]
 *         description: Filter by job type
 *       - in: query
 *         name: budget_min
 *         schema:
 *           type: number
 *         description: Minimum budget filter
 *       - in: query
 *         name: budget_max
 *         schema:
 *           type: number
 *         description: Maximum budget filter
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
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 5
 *                         totalItems:
 *                           type: integer
 *                           example: 50
 *                         itemsPerPage:
 *                           type: integer
 *                           example: 10
 *       500:
 *         description: Failed to get jobs
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/jobs', getJobs);

/**
 * @swagger
 * /engineers/jobs/{id}:
 *   get:
 *     summary: Get specific job details
 *     tags: [Engineers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *         description: Failed to get job details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/jobs/:id', getJobDetails);

/**
 * @swagger
 * /engineers/jobs/{id}/apply:
 *   post:
 *     summary: Apply for a specific job
 *     tags: [Engineers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Job ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               cover_letter:
 *                 type: string
 *                 example: "I am very interested in this position because..."
 *               proposed_rate:
 *                 type: number
 *                 format: decimal
 *                 example: 75.00
 *               availability:
 *                 type: string
 *                 example: "Available to start immediately"
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Application submitted successfully
 *                 data:
 *                   $ref: '#/components/schemas/Application'
 *       400:
 *         description: Already applied or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Job not found or no longer available
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Application failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/jobs/:id/apply', validateApplication, applyForJob);

/**
 * @swagger
 * /engineers/applications:
 *   get:
 *     summary: Get engineer's job applications with pagination
 *     tags: [Engineers]
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
 *           enum: [pending, reviewed, shortlisted, rejected, hired]
 *         description: Filter by application status
 *     responses:
 *       200:
 *         description: Applications retrieved successfully
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
 *                     applications:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Application'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 3
 *                         totalItems:
 *                           type: integer
 *                           example: 25
 *                         itemsPerPage:
 *                           type: integer
 *                           example: 10
 *       500:
 *         description: Failed to get applications
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/applications', getApplications);

/**
 * @swagger
 * /engineers/applications/{id}:
 *   put:
 *     summary: Update application status (withdraw only)
 *     tags: [Engineers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Application ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [pending]
 *                 example: pending
 *                 description: Engineers can only withdraw (set to pending)
 *     responses:
 *       200:
 *         description: Application updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Application updated successfully
 *                 data:
 *                   $ref: '#/components/schemas/Application'
 *       400:
 *         description: Invalid status update
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Application not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to update application
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/applications/:id', updateApplication);

/**
 * @swagger
 * /engineers/projects:
 *   get:
 *     summary: Get engineer's current and past projects
 *     tags: [Engineers]
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
 *           enum: [planning, in_progress, review, completed, cancelled]
 *         description: Filter by project status
 *     responses:
 *       200:
 *         description: Projects retrieved successfully
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
 *                     projects:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Project'
 *                     pagination:
 *                       type: object
 *                       properties:
 *                         currentPage:
 *                           type: integer
 *                           example: 1
 *                         totalPages:
 *                           type: integer
 *                           example: 2
 *                         totalItems:
 *                           type: integer
 *                           example: 15
 *                         itemsPerPage:
 *                           type: integer
 *                           example: 10
 *       500:
 *         description: Failed to get projects
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/projects', getProjects);

/**
 * @swagger
 * /engineers/projects/{id}:
 *   get:
 *     summary: Get specific project details
 *     tags: [Engineers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Project details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Project'
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to get project details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/projects/:id', getProjectDetails);

module.exports = router;