const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Project Managers
 *   description: Project Manager endpoints for job posting, application management, and project oversight
 */

const { authenticate, authorize } = require('../middleware/auth');
const { validateJobCreation } = require('../middleware/validation');
const pmController = require('../controllers/pmController');
const { upload } = require('../middleware/upload');

const router = express.Router();

// All routes require authentication and project manager role
router.use(authenticate, authorize('project_manager'));

/**
 * @swagger
 * /pm/dashboard:
 *   get:
 *     summary: Get project manager dashboard data
 *     tags: [Project Managers]
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/dashboard', pmController.getDashboard);

/**
 * @swagger
 * /pm/profile:
 *   put:
 *     summary: Update project manager profile (supports avatar upload). Stores GCS object name; returns temporary signed URL.
 *     tags: [Project Managers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               company_name:
 *                 type: string
 *                 example: "Acme Corp"
 *               company_size:
 *                 type: string
 *                 example: "11-50"
 *               industry:
 *                 type: string
 *                 example: "IT Services"
 *               bio:
 *                 type: string
 *                 example: "We build great products."
 *               website_url:
 *                 type: string
 *                 example: "https://acme.example"
 *               linkedin_url:
 *                 type: string
 *                 example: "https://linkedin.com/in/john-doe"
 *               location:
 *                 type: string
 *                 example: "London, UK"
 *               timezone:
 *                 type: string
 *                 example: "Europe/London"
 *               first_name:
 *                 type: string
 *                 example: "Jane"
 *               last_name:
 *                 type: string
 *                 example: "Doe"
 *               phone_number:
 *                 type: string
 *                 example: "+2348012345678"
 *               city:
 *                 type: string
 *                 example: "London"
 *               country:
 *                 type: string
 *                 example: "UK"
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Optional profile image file (image/*)
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
 *                   example: "Profile updated successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     project_manager:
 *                       $ref: '#/components/schemas/ProjectManager'
 *                     avatar_url:
 *                       type: string
 *                       nullable: true
 *                       description: Temporary signed URL for the avatar (omitted if no avatar)
 *       404:
 *         description: Project manager profile not found
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
router.put('/profile', upload.single('avatar'), pmController.updateProfile);

/**
 * @swagger
 * /pm/jobs:
 *   post:
 *     summary: Create new job posting
 *     tags: [Project Managers]
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
 *                 example: "Senior React Developer"
 *               company:
 *                 type: string
 *                 example: "Stechad ltd"
 *               location:
 *                 type: string
 *                 example: "remote"
 *               description:
 *                 type: string
 *                 example: "We are looking for an experienced React developer..."
 *               salary:
 *                 type: string
 *                 example: "100usd"
 *               duration:
 *                 type: string
 *                 example: "3 months"
 *               openings:
 *                 type: number
 *                 example: "1"
 *               employment_type:
 *                 type: string
 *                 enum: ['full-time', 'contract', 'part-time']
 *                 example: "contract"
 *               experience_level:
 *                 type: string
 *                 enum: [entry, intermediate, senior, expert]
 *                 example: "senior"
 *               skills_required:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["React", "TypeScript", "Node.js"]
 *               requirements:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["5+ years React experience", "TypeScript proficiency"]
 *               responsibilities:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Build clean architecture", "Debug projects"]
 *               deadline:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-11-01T00:00:00Z"
 *     responses:
 *       201:
 *         description: Job created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Validation error
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
router.post('/jobs', validateJobCreation, pmController.createJob);

/**
 * @swagger
 * /pm/jobs:
 *   get:
 *     summary: Get specific project manager's job postings
 *     tags: [Project Managers]
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
 *           enum: [draft, active, closed]
 *         description: Filter by job status
 *     responses:
 *       200:
 *         description: Jobs retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PaginationResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/jobs', pmController.getJobs);

/**
 * @swagger
 * /pm/projects:
 *   get:
 *     summary: Get project manager's projects
 *     tags: [Project Managers]
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
 *               $ref: '#/components/schemas/PaginationResponse'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/projects', pmController.getPmProjects);

module.exports = router;