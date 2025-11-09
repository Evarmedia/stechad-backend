const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Engineers
 *   description: Engineer-specific endpoints for profile management, job applications, and projects
 */

const {
  getEngineers,
  completeOnboarding,
  getDashboard,
  updateProfile,
  // getJobs,
  getJobDetails,
  applyForJob,
  getApplications,
  getProjects,
  getProjectDetails
} = require('../controllers/engineerController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateApplication } = require('../middleware/validation');

const router = express.Router();

// All routes require authentication and engineer role
router.use(authenticate);

/**
 * @swagger
 * /engineers/all:
 *   get:
 *     summary: Get all engineers with pagination(Admin/PM)
 *     tags: [Engineers]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *       - in: query
 *         name: is_onboarded
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: availability
 *         schema:
 *           type: string
 *           enum: [available, busy, unavailable]
 *     responses:
 *       200:
 *         description: Engineers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/all', authorize('project_manager', 'admin'), getEngineers);

/**
 * @swagger
 * /engineers/onboarding:
 *   post:
 *     summary: Complete engineer onboarding
 *     tags: [Engineers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               open_to_nearby_cities:
 *                 type: boolean
 *               languages:
 *                 type: array
 *                 items:
 *                   type: string
 *                   example: ["English", "Spanish"]
 *               language_proficiency:
 *                 type: string
 *                 enum: [basic, conversational, fluent, native]
 *               has_drivers_license:
 *                 type: boolean
 *                 example: true
 *               has_car:
 *                 type: boolean
 *                 example: true
 *               is_native:
 *                 type: boolean
 *                 example: true
 *               work_authorized:
 *                 type: boolean
 *                 example: true
 *               specialization:
 *                 type: array
 *                 items:
 *                   type: string
 *                   example: ["Frontend Development", "Backend Development"]
 *               skill_level:
 *                 type: string
 *                 enum: [beginner, intermediate, advanced, expert]
 *                 example: expert
 *               years_of_experience:
 *                 type: number
 *                 example: 5
 *               certifications:
 *                 type: array
 *                 items:
 *                   type: string
 *                   example: ["AWS Certified Developer", "Scrum Master"]
 *               project_types:
 *                 type: array
 *                 items:
 *                   type: string
 *                   example: ["Web Applications", "Mobile Apps"]
 *               open_to_training:
 *                 type: boolean
 *                 example: true
 *               follows_linkedin:
 *                 type: boolean
 *                 example: true
 *               referee_info:
 *                 type: string
 *                 example: "John Doe, johndoe@email.com"
 *               newsletter:
 *                 type: boolean
 *                 example: true
 *               special_preferences:
 *                 type: string
 *                 example: "No weekend work"
 *               cv_url:
 *                 type: string
 *                 example: "htp://mycv.com/johndoe"
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
router.post('/onboarding', authorize('engineer'), completeOnboarding);

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
router.get('/dashboard', authorize('engineer'), getDashboard);

/**
 * @swagger
 * /engineers/profile:
 *   put:
 *     summary: Update engineer profile (supports avatar & CV upload). Stores GCS object names; returns temporary signed URLs.
 *     tags: [Engineers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *                 example: "1990-01-01"
 *               years_of_experience:
 *                 type: integer
 *                 example: 5
 *               project_types:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of project types (JSON string or comma-separated also accepted)
 *                 example: ["Web Development","Mobile App Development"]
 *               availability:
 *                 type: string
 *                 example: "available"
 *               specialization:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: Array of specializations (JSON string or comma-separated also accepted)
 *                 example: ["Backend Development","Frontend Development"]
 *               skill_level:
 *                 type: string
 *                 example: "advanced"
 *               first_name:
 *                 type: string
 *                 example: "John"
 *               last_name:
 *                 type: string
 *                 example: "Doe"
 *               phone_number:
 *                 type: string
 *                 example: "+1234567890"
 *               city:
 *                 type: string
 *                 example: "New York"
 *               country:
 *                 type: string
 *                 example: "USA"
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Optional profile image (image/*)
 *               cv:
 *                 type: string
 *                 format: binary
 *                 description: Optional CV file (PDF only)
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
 *                   type: object
 *                   properties:
 *                     engineer:
 *                       $ref: '#/components/schemas/Engineer'
 *                     avatar_url:
 *                       type: string
 *                       nullable: true
 *                       description: Temporary signed URL for the avatar (may be omitted if no avatar)
 *                     cv_url:
 *                       type: string
 *                       nullable: true
 *                       description: Temporary signed URL for the CV (may be omitted if no CV)
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
router.put('/profile', authorize('engineer'), updateProfile);

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
// router.get('/jobs', getJobs);

/**
 * @swagger
 * /engineers/jobs/{jobs_id}:
 *   get:
 *     summary: Get specific job details
 *     tags: [Engineers]
 *     parameters:
 *       - in: path
 *         name: jobs_id
 *         required: true
 *         schema:
 *           type: string
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
router.get('/jobs/:jobs_id', authorize('engineer'), getJobDetails);

/**
 * @swagger
 * /engineers/jobs/{jobs_id}/apply:
 *   post:
 *     summary: Apply for a specific job
 *     tags: [Engineers]
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
router.post('/jobs/:jobs_id/apply', authorize('engineer'), applyForJob);

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
router.get('/applications', authorize('engineer'), getApplications);

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
router.get('/projects', authorize('engineer'), getProjects);

/**
 * @swagger
 * /engineers/projects/{projects_id}:
 *   get:
 *     summary: Get specific project details
 *     tags: [Engineers]
 *     parameters:
 *       - in: path
 *         name: projects_id
 *         required: true
 *         schema:
 *           type: string
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
router.get('/projects/:id', authorize('engineer'), getProjectDetails);

module.exports = router;