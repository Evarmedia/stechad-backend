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
 *   get:
 *     summary: Get project manager profile details
 *     tags: [Project Managers]
 *     responses:
 *       200:
 *         description: Profile retrieved successfully
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
router.get('/profile', pmController.getProfile);

/**
 * @swagger
 * /pm/profile:
 *   put:
 *     summary: Update project manager profile
 *     tags: [Project Managers]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               company_name:
 *                 type: string
 *                 example: "Tech Solutions Inc"
 *               company_size:
 *                 type: string
 *                 example: "50-100"
 *               industry:
 *                 type: string
 *                 example: "Technology"
 *               bio:
 *                 type: string
 *                 example: "Experienced project manager with 10+ years in tech"
 *               website_url:
 *                 type: string
 *                 example: "https://techsolutions.com"
 *               linkedin_url:
 *                 type: string
 *                 example: "https://linkedin.com/in/pmjohn"
 *               location:
 *                 type: string
 *                 example: "San Francisco, CA"
 *               timezone:
 *                 type: string
 *                 example: "America/Los_Angeles"
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
 *               avatar_url:
 *                 type: string
 *                 example: "https://example.com/avatar.jpg"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       404:
 *         description: Project manager profile not found
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
router.put('/profile', pmController.updateProfile);

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
 *     summary: Get project manager's job postings
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
 * /pm/jobs/{jobs_id}:
 *   put:
 *     summary: Update job posting
 *     tags: [Project Managers]
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
router.put('/jobs/:jobs_id', pmController.updateJob); // move

/**
 * @swagger
 * /pm/jobs/{jobs_id}:
 *   delete:
 *     summary: Delete job posting
 *     tags: [Project Managers]
 *     parameters:
 *       - in: path
 *         name: jobs_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Job ID
 *     responses:
 *       200:
 *         description: Job deleted successfully
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
router.delete('/jobs/:jobs_id', pmController.deleteJob); // move

/**
 * @swagger
 * /pm/jobs/{jobs_id}/applicants:
 *   get:
 *     summary: Get applicants for specific job
 *     tags: [Project Managers]
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
router.get('/jobs/:jobs_id/applicants', pmController.getJobApplicants); // move

/**
 * @swagger
 * /pm/applications/{applications_id}/status:
 *   put:
 *     summary: Update application status
 *     tags: [Project Managers]
 *     parameters:
 *       - in: path
 *         name: applications_id
 *         required: true
 *         schema:
 *           type: string
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
 *                 enum: [pending, reviewed, shortlisted, rejected, hired]
 *                 example: "shortlisted"
 *               feedback:
 *                 type: string
 *                 example: "Great profile, moving to next round"
 *     responses:
 *       200:
 *         description: Application status updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       404:
 *         description: Application not found
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
router.put('/applications/:applications_id/status', pmController.updateApplicationStatus); // move

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
router.get('/projects', pmController.getProjects);

/**
 * @swagger
 * /pm/projects:
 *   post:
 *     summary: Create new project
 *     tags: [Project Managers]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *             properties:
 *               title:
 *                 type: string
 *                 example: "E-commerce Website Development"
 *               description:
 *                 type: string
 *                 example: "Building a modern e-commerce platform with React and Node.js"
 *               job_id:
 *                 type: integer
 *                 example: 1
 *               progress:
 *                 type: integer
 *                 example: 50
 *               priority:
 *                 type: string
 *                 enum: [high, medium, low, critical]
 *                 example: "high"
 *               start_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-02-01T00:00:00Z"
 *               deadline:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-05-01T00:00:00Z"
 *               team:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Micheal Scott", "Pam Beesly"]
 *     responses:
 *       201:
 *         description: Project created successfully
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
router.post('/projects', pmController.createProject);

/**
 * @swagger
 * /pm/projects/{projects_id}:
 *   put:
 *     summary: Update project details
 *     tags: [Project Managers]
 *     parameters:
 *       - in: path
 *         name: projects_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Exam Website Development"
 *               description:
 *                 type: string
 *                 example: "Building a modern e-Exam platform with Nextjs and Node.js"
 *               job_id:
 *                 type: integer
 *                 example: optional
 *               status:
 *                 type: string
 *                 enum: [planning, in_progress, completed, on_hold, cancelled]
 *                 example: "in_progress"
 *               progress:
 *                 type: integer
 *                 example: 70
 *               priority:
 *                 type: string
 *                 enum: [high, medium, low, critical]
 *                 example: "medium"
 *               start_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-02-01T00:00:00Z"
 *               deadline:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-05-01T00:00:00Z"
 *               team:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["Micheal Scott", "Pam Beesly"]
 *     responses:
 *       200:
 *         description: Project updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       404:
 *         description: Project not found
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
router.put('/projects/:projects_id', pmController.updateProject);

/**
 * @swagger
 * /pm/projects/{projects_id}:
 *   delete:
 *     summary: Delete project
 *     tags: [Project Managers]
 *     parameters:
 *       - in: path
 *         name: projects_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Project deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       404:
 *         description: Project not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Project deletion failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete('/projects/:projects_id', pmController.deleteProject);

module.exports = router;