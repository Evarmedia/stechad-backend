const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Applications
 *   description: Application management endpoints for job applications
 */

const { authenticate, authorize } = require('../middleware/auth');
const {
  getApplications,
  getApplicationById,
  updateApplicationStatus,
  getApplicationStats,
  deleteApplication
} = require('../controllers/applicationController');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /applications:
 *   get:
 *     summary: Get all applications with filtering and pagination
 *     tags: [Applications]
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
 *           enum: [pending, reviewed, accepted, rejected]
 *         description: Filter by application status
 *       - in: query
 *         name: job_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by job ID
 *       - in: query
 *         name: engineer_id
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Filter by engineer ID
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
 *                       $ref: '#/components/schemas/PaginationInfo'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', authorize('admin', 'project_manager'), getApplications);

/**
 * @swagger
 * /applications/{applications_id}:
 *   get:
 *     summary: Get application details by ID
 *     tags: [Applications]
 *     parameters:
 *       - in: path
 *         name: applications_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Application ID
 *     responses:
 *       200:
 *         description: Application details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/Application'
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
router.get('/:applications_id', getApplicationById);

/**
 * @swagger
 * /applications/{applications_id}/status:
 *   put:
 *     summary: Update application status
 *     tags: [Applications]
 *     parameters:
 *       - in: path
 *         name: applications_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
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
 *                 enum: [pending, reviewed, shortlisted, accepted, rejected]
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
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Application status updated successfully"
 *                 data:
 *                   $ref: '#/components/schemas/Application'
 *       403:
 *         description: Not authorized to update this application
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
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put('/:applications_id/status', authorize('admin', 'project_manager'), updateApplicationStatus);

/**
 * @swagger
 * /applications/stats/overview:
 *   get:
 *     summary: Get application statistics and analytics
 *     tags: [Applications]
 *     responses:
 *       200:
 *         description: Application statistics retrieved successfully
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
 *                         totalApplications:
 *                           type: integer
 *                           example: 500
 *                         pendingApplications:
 *                           type: integer
 *                           example: 120
 *                         reviewedApplications:
 *                           type: integer
 *                           example: 200
 *                         acceptedApplications:
 *                           type: integer
 *                           example: 80
 *                         rejectedApplications:
 *                           type: integer
 *                           example: 100
 *                     statusStats:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           status:
 *                             type: string
 *                           count:
 *                             type: integer
 *                     recentApplications:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Application'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/stats/overview', authorize('admin', 'project_manager'), getApplicationStats);

/**
 * @swagger
 * /applications/{applications_id}:
 *   delete:
 *     summary: Delete application (Admin only)
 *     tags: [Applications]
 *     parameters:
 *       - in: path
 *         name: applications_id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Application ID
 *     responses:
 *       200:
 *         description: Application deleted successfully
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
 *                   example: "Application deleted successfully"
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
router.delete('/:applications_id', authorize('admin'), deleteApplication);

module.exports = router;