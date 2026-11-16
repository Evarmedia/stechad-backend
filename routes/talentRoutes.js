const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Talents
 *   description: Talent-specific endpoints for profile management, job applications, and projects
 */

const {
  getTalents,
  completeOnboarding,
  getDashboard,
  updateProfile,
  // getJobs,
  getJobDetails,
  applyForJob,
  getApplications,
  getProjects,
  getProjectDetails,
} = require('../controllers/talentController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateApplication } = require('../middleware/validation');

const { upload } = require('../middleware/upload')

const router = express.Router();

// All routes require authentication and talent role
router.use(authenticate);

/**
 * @swagger
 * /talents/all:
 *   get:
 *     summary: Get all talents with pagination(Admin/PM)
 *     tags: [Talents]
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
 *         description: Talents retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/all', authorize('project_manager', 'admin'), getTalents);

/**
 * @swagger
 * /talents/onboarding:
 *   put:
 *     summary: Complete talent onboarding (supports file upload & form fields)
 *     tags: [Talents]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - date_of_birth
 *             properties:
 *               cv_file:
 *                 type: string
 *                 format: binary
 *                 description: Upload the talent's CV (PDF, DOCX, etc.)
 *
 *               date_of_birth:
 *                 $ref: '#/components/schemas/Birthday'
 *
 *               open_to_nearby_cities:
 *                 type: string
 *                 description: Boolean value as string (true/false)
 *                 example: "true"
 *
 *               languages:
 *                 type: string
 *                 description: JSON array string OR comma-separated values
 *                 example: '["English","French"]'
 *
 *               language_proficiency:
 *                 type: string
 *                 enum: [basic, conversational, fluent, native]
 *                 example: "fluent"
 *
 *               has_drivers_license:
 *                 type: string
 *                 example: "true"
 *
 *               has_car:
 *                 type: string
 *                 example: "false"
 *
 *               is_native:
 *                 type: string
 *                 example: "true"
 *
 *               work_authorized:
 *                 type: string
 *                 example: "true"
 *
 *               specialization:
 *                 type: string
 *                 description: JSON array or CSV
 *                 example: '["Frontend","Backend"]'
 *
 *               skill_level:
 *                 type: string
 *                 enum: [beginner, intermediate, advanced, expert]
 *                 example: "advanced"
 *
 *               years_of_experience:
 *                 type: string
 *                 description: Number represented as string
 *                 example: "5"
 *
 *               certifications:
 *                 type: string
 *                 description: JSON array or CSV
 *                 example: '["AWS","Scrum Master"]'
 *
 *               project_types:
 *                 type: string
 *                 description: JSON array or CSV
 *                 example: "Web Apps,Mobile Apps"
 *
 *               open_to_training:
 *                 type: string
 *                 example: "true"
 *
 *               is_freelancer:
 *                 type: string
 *                 description: Boolean value as string (true/false)
 *                 example: "true"
 *
 *               follows_linkedin:
 *                 type: string
 *                 example: "false"
 *
 *               referee_info:
 *                 type: string
 *                 example: "John Doe, johndoe@gmail.com"
 *
 *               newsletter:
 *                 type: string
 *                 example: "true"
 *
 *               special_preferences:
 *                 type: string
 *                 example: "No weekend shifts"
 *
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
 *                   type: object
 *                   properties:
 *                     talent:
 *                       $ref: '#/components/schemas/Talent'
 *                     cv_url:
 *                       type: string
 *                       example: "https://storage.googleapis.com/bucket/cv123.pdf?X-Goog-Signature=..."
 *
 *       404:
 *         description: Talent profile not found
 *       500:
 *         description: Onboarding failed
 */
// UPDATE: Added upload.single('cv_file') middleware to handle file upload
router.put('/onboarding', authorize('talent'), upload.single('cv_file'), completeOnboarding);

/**
 * @swagger
 * /talents/dashboard:
 *   get:
 *     summary: Get talent dashboard data with statistics and recent activities
 *     tags: [Talents]
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
 *                     talent:
 *                       $ref: '#/components/schemas/Talent'
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
router.get('/dashboard', authorize('talent'), getDashboard);

/**
 * @swagger
 * /talents/profile:
 *   put:
 *     summary: Update talent profile (supports avatar & CV upload). Stores GCS object names; returns temporary signed URLs.
 *     tags: [Talents]
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
 *                 $ref: '#/components/schemas/Birthday'
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
 *               cv_file:
 *                 type: string
 *                 format: binary
 *                 description: Optional CV file (PDF only)
 *     responses:
 *       400:
 *         description: Birthday must be a valid month and day in MM-DD format.
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
 *                     talent:
 *                       $ref: '#/components/schemas/Talent'
 *                     avatar_url:
 *                       type: string
 *                       nullable: true
 *                       description: Temporary signed URL for the avatar (may be omitted if no avatar)
 *                     cv_url:
 *                       type: string
 *                       nullable: true
 *                       description: Temporary signed URL for the CV (may be omitted if no CV)
 *       404:
 *         description: Talent profile not found
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
// UPDATE: Added upload.fields() middleware to handle both avatar and cv file uploads
router.put('/profile', authorize('talent'), upload.fields([{name:'avatar', maxCount: 1}, {name:'cv_file', maxCount: 1}]), updateProfile);

/**
 * @swagger
 * /talents/jobs/{jobs_id}:
 *   get:
 *     summary: Get specific job details
 *     tags: [Talents]
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
router.get('/jobs/:jobs_id', authorize('talent'), getJobDetails);

/**
 * @swagger
 * /talents/jobs/{jobs_id}/apply:
 *   post:
 *     summary: Apply for a specific job
 *     tags: [Talents]
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
router.post('/jobs/:jobs_id/apply', authorize('talent'), applyForJob);

/**
 * @swagger
 * /talents/applications:
 *   get:
 *     summary: Get talent's job applications with pagination
 *     tags: [Talents]
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
router.get('/applications', authorize('talent'), getApplications);

/**
 * @swagger
 * /talents/projects:
 *   get:
 *     summary: Get talent's current and past projects
 *     tags: [Talents]
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
router.get('/projects', authorize('talent'), getProjects);

/**
 * @swagger
 * /talents/projects/{projects_id}:
 *   get:
 *     summary: Get specific project details
 *     tags: [Talents]
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
router.get('/projects/:id', authorize('talent'), getProjectDetails);

module.exports = router;