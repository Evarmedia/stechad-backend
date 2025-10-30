const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Data Export
 *   description: Data export endpoints for generating reports and backups
 */

const { authenticate, authorize } = require('../middleware/auth');
const { exportEngineers, exportJobs, exportApplications } = require('../controllers/exportController');

const router = express.Router();

/**
 * @swagger
 * /export/engineers:
 *   get:
 *     summary: Export engineers data to CSV/Excel
 *     tags: [Data Export]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, excel, json]
 *           default: csv
 *         description: Export format
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Comma-separated list of fields to include
 *         example: "id,email,first_name,last_name,skills,experience_years"
 *       - in: query
 *         name: is_vetted
 *         schema:
 *           type: boolean
 *         description: Filter by vetting status
 *       - in: query
 *         name: availability
 *         schema:
 *           type: string
 *           enum: [available, busy, unavailable]
 *         description: Filter by availability
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by registration date from
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by registration date to
 *     responses:
 *       200:
 *         description: Engineers data exported successfully
 *         content:
 *           application/csv:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
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
 *                     $ref: '#/components/schemas/Engineer'
 *       403:
 *         description: Access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Export failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/engineers', authenticate, authorize('admin'), exportEngineers);

/**
 * @swagger
 * /export/jobs:
 *   get:
 *     summary: Export jobs data to CSV/Excel
 *     tags: [Data Export]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, excel, json]
 *           default: csv
 *         description: Export format
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Comma-separated list of fields to include
 *         example: "id,title,description,budget_min,budget_max,status"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, open, closed, in_progress, completed]
 *         description: Filter by job status
 *       - in: query
 *         name: posted_by
 *         schema:
 *           type: integer
 *         description: Filter by poster user ID
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by posting date from
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by posting date to
 *     responses:
 *       200:
 *         description: Jobs data exported successfully
 *         content:
 *           application/csv:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
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
 *                     $ref: '#/components/schemas/Job'
 *       403:
 *         description: Access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Export failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/jobs', authenticate, authorize('admin', 'project_manager'), exportJobs);

/**
 * @swagger
 * /export/applications:
 *   get:
 *     summary: Export applications data to CSV/Excel
 *     tags: [Data Export]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [csv, excel, json]
 *           default: csv
 *         description: Export format
 *       - in: query
 *         name: fields
 *         schema:
 *           type: string
 *         description: Comma-separated list of fields to include
 *         example: "id,job_id,engineer_id,status,proposed_rate,created_at"
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, reviewed, shortlisted, rejected, hired]
 *         description: Filter by application status
 *       - in: query
 *         name: job_id
 *         schema:
 *           type: integer
 *         description: Filter by specific job ID
 *       - in: query
 *         name: engineer_id
 *         schema:
 *           type: integer
 *         description: Filter by specific engineer ID
 *       - in: query
 *         name: date_from
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by application date from
 *       - in: query
 *         name: date_to
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter by application date to
 *     responses:
 *       200:
 *         description: Applications data exported successfully
 *         content:
 *           application/csv:
 *             schema:
 *               type: string
 *               format: binary
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
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
 *                     $ref: '#/components/schemas/Application'
 *       403:
 *         description: Access denied
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Export failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/applications', authenticate, authorize('admin', 'project_manager'), exportApplications);

module.exports = router;