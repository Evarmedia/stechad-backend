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
 *     responses:
 *       200:
 *         description: Profile updated successfully
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
 *               - description
 *               - budget_type
 *               - experience_level
 *               - job_type
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Senior React Developer"
 *               description:
 *                 type: string
 *                 example: "We are looking for an experienced React developer..."
 *               requirements:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["5+ years React experience", "TypeScript proficiency"]
 *               skills_required:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["React", "TypeScript", "Node.js"]
 *               budget_min:
 *                 type: number
 *                 format: decimal
 *                 example: 5000.00
 *               budget_max:
 *                 type: number
 *                 format: decimal
 *                 example: 8000.00
 *               budget_type:
 *                 type: string
 *                 enum: [hourly, fixed, negotiable]
 *                 example: "fixed"
 *               duration:
 *                 type: string
 *                 example: "3 months"
 *               location:
 *                 type: string
 *                 example: "Remote"
 *               remote_allowed:
 *                 type: boolean
 *                 example: true
 *               experience_level:
 *                 type: string
 *                 enum: [entry, intermediate, senior, expert]
 *                 example: "senior"
 *               job_type:
 *                 type: string
 *                 enum: [full_time, part_time, contract, freelance]
 *                 example: "contract"
 *               deadline:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-03-01T00:00:00Z"
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
 *           enum: [draft, open, closed, in_progress, completed]
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
 * /pm/jobs/{id}:
 *   put:
 *     summary: Update job posting
 *     tags: [Project Managers]
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
 *               title:
 *                 type: string
 *                 example: "Updated Job Title"
 *               description:
 *                 type: string
 *                 example: "Updated job description..."
 *               status:
 *                 type: string
 *                 enum: [draft, open, closed, in_progress, completed]
 *                 example: "open"
 *               budget_min:
 *                 type: number
 *                 format: decimal
 *                 example: 6000.00
 *               budget_max:
 *                 type: number
 *                 format: decimal
 *                 example: 9000.00
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
router.put('/jobs/:id', pmController.updateJob);

/**
 * @swagger
 * /pm/jobs/{id}:
 *   delete:
 *     summary: Delete job posting
 *     tags: [Project Managers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
router.delete('/jobs/:id', pmController.deleteJob);

/**
 * @swagger
 * /pm/jobs/{id}/applicants:
 *   get:
 *     summary: Get applicants for specific job
 *     tags: [Project Managers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *           enum: [pending, reviewed, shortlisted, rejected, hired]
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
router.get('/jobs/:id/applicants', pmController.getJobApplicants);

/**
 * @swagger
 * /pm/applications/{id}/status:
 *   put:
 *     summary: Update application status
 *     tags: [Project Managers]
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
router.put('/applications/:id/status', pmController.updateApplicationStatus);

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
 *               - engineer_id
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
 *               engineer_id:
 *                 type: integer
 *                 example: 5
 *               budget:
 *                 type: number
 *                 format: decimal
 *                 example: 7500.00
 *               start_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-02-01T00:00:00Z"
 *               end_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-05-01T00:00:00Z"
 *               milestones:
 *                 type: array
 *                 items:
 *                   type: object
 *                 example: [{"name": "Design Phase", "deadline": "2024-02-15", "completed": false}]
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
 * /pm/projects/{id}:
 *   put:
 *     summary: Update project details
 *     tags: [Project Managers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
 *                 example: "Updated Project Title"
 *               description:
 *                 type: string
 *                 example: "Updated project description"
 *               status:
 *                 type: string
 *                 enum: [planning, in_progress, review, completed, cancelled]
 *                 example: "in_progress"
 *               progress:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 example: 75
 *               budget:
 *                 type: number
 *                 format: decimal
 *                 example: 8000.00
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
router.put('/projects/:id', pmController.updateProject);

/**
 * @swagger
 * /pm/projects/{id}:
 *   delete:
 *     summary: Delete project
 *     tags: [Project Managers]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
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
router.delete('/projects/:id', pmController.deleteProject);

module.exports = router;