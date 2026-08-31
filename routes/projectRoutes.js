const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Projects
 *   description: Project management endpoints for creating and managing projects
 */

const { authenticate, authorize } = require('../middleware/auth');
const {
  getAllProjects,
  getProjectManagerProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getProjectStats
} = require('../controllers/projectController');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /projects:
 *   get:
 *     summary: Get all projects with filtering and pagination
 *     tags: [Projects]
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
 *           enum: [planning, in_progress, completed, on_hold, cancelled]
 *         description: Filter by project status
 *       - in: query
 *         name: priority
 *         schema:
 *           type: string
 *           enum: [high, medium, low, critical]
 *         description: Filter by project priority
 *       - in: query
 *         name: project_manager_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by project manager ID
 *       - in: query
 *         name: engineer_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by engineer ID
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
 *                       $ref: '#/components/schemas/PaginationInfo'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', authorize('admin', 'project_manager'), getAllProjects);


/**
 * @swagger
 * /projects/my-projects:
 *   get:
 *     summary: Get projects assigned to the authenticated project manager
 *     tags: [Projects]
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
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Project'
 *       403:
 *         description: Not authorized to access this resource
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
router.get(
  "/my-projects",
  authorize("project_manager"),
  getProjectManagerProjects,
);

// Keep static routes ahead of /:projects_id so Express does not treat "stats" as an ID.
router.get('/stats/overview', authorize('admin', 'project_manager'), getProjectStats);

/**
 * @swagger
 * /projects/{projects_id}:
 *   get:
 *     summary: Get project details by ID
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projects_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/:projects_id', authorize('admin', 'project_manager'), getProjectById);

/**
 * @swagger
 * /projects:
 *   post:
 *     summary: Create new project
 *     tags: [Projects]
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
 *               project_manager_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: Project manager profile ID (or user ID). Admins may omit/null this to leave the project unassigned.
 *               status:
 *                 type: string
 *                 enum: [planning, in_progress, completed, on_hold, cancelled]
 *                 default: planning
 *               priority:
 *                 type: string
 *                 enum: [high, medium, low, critical]
 *                 default: medium
 *               progress:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 default: 0
 *               team:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["John Doe", "Jane Smith"]
 *               tasks:
 *                 type: array
 *                 items:
 *                   type: object
 *                 example: [{"id": 1, "title": "Setup project", "status": "pending"}]
 *               start_date:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-02-01T00:00:00Z"
 *               deadline:
 *                 type: string
 *                 format: date-time
 *                 example: "2024-05-01T00:00:00Z"
 *               feedback:
 *                 type: string
 *                 example: "Initial project setup completed"
 *     responses:
 *       201:
 *         description: Project created successfully
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
 *                   example: "Project created successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Project'
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       404:
 *         description: Job or Engineer not found
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
router.post('/', authorize('admin', 'project_manager'), createProject);

/**
 * @swagger
 * /projects/{projects_id}:
 *   put:
 *     summary: Update project details
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projects_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *                 example: "Updated E-commerce Website"
 *               description:
 *                 type: string
 *                 example: "Updated project description"
 *               project_manager_id:
 *                 type: string
 *                 format: uuid
 *                 nullable: true
 *                 description: Project manager profile ID (or user ID). Admins may send null to unassign the project.
 *               status:
 *                 type: string
 *                 enum: [planning, in_progress, completed, on_hold, cancelled]
 *                 example: "in_progress"
 *               priority:
 *                 type: string
 *                 enum: [high, medium, low, critical]
 *                 example: "high"
 *               progress:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 example: 50
 *               team:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["John Doe", "Jane Smith", "Bob Wilson"]
 *               start_date:
 *                 type: string
 *                 format: date-time
 *               deadline:
 *                 type: string
 *                 format: date-time
 *               feedback:
 *                 type: string
 *                 example: "Project is progressing well"
 *     responses:
 *       200:
 *         description: Project updated successfully
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
 *                   example: "Project updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Project'
 *       403:
 *         description: Not authorized to update this project
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
router.put('/:projects_id', authorize('admin', 'project_manager', 'engineer'), updateProject);

/**
 * @swagger
 * /projects/{projects_id}:
 *   delete:
 *     summary: Delete project
 *     description: Admin and Super Admin can delete projects in any status. Project Managers can delete only projects they own (or unassigned projects) while the project is planning, cancelled, or on hold.
 *     tags: [Projects]
 *     parameters:
 *       - in: path
 *         name: projects_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Project ID
 *     responses:
 *       200:
 *         description: Project deleted successfully
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
 *                   example: "Project deleted successfully"
 *       400:
 *         description: A Project Manager tried to delete a project that is in progress or completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: The caller is not an Admin/Super Admin or the Project Manager does not own the project
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
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
router.delete('/:projects_id', authorize('admin', 'project_manager'), deleteProject);

/**
 * @swagger
 * /projects/stats/overview:
 *   get:
 *     summary: Get project statistics and analytics
 *     tags: [Projects]
 *     responses:
 *       200:
 *         description: Project statistics retrieved successfully
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
 *                         totalProjects:
 *                           type: integer
 *                           example: 100
 *                         planningProjects:
 *                           type: integer
 *                           example: 20
 *                         inProgressProjects:
 *                           type: integer
 *                           example: 35
 *                         completedProjects:
 *                           type: integer
 *                           example: 40
 *                         onHoldProjects:
 *                           type: integer
 *                           example: 3
 *                         cancelledProjects:
 *                           type: integer
 *                           example: 2
 *                         averageProgress:
 *                           type: integer
 *                           example: 65
 *                     statusStats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           status:
 *                             type: string
 *                           count:
 *                             type: integer
 *                     priorityStats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           priority:
 *                             type: string
 *                           count:
 *                             type: integer
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
module.exports = router;
