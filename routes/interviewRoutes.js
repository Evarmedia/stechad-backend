const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  scheduleInterview,
  getAllInterviews,
  getInterviewById,
  getMyInterviews,
  updateInterview,
} = require('../controllers/interviewController');

const router = express.Router();

router.use(authenticate)

/**
 * @swagger
 * tags:
 *   - name: Interviews
 *     description: Schedule and manage interviews
 */

/**
 * @swagger
 * /interviews:
 *   post:
 *     summary: Schedule an interview (PM/Admin)
 *     tags:
 *       - Interviews
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - engineer_id
 *               - job_id
 *               - date_time
 *             properties:
 *               engineer_id:
 *                 type: string
 *                 example: "1f2e3d4c-5b6a-7d8e-9f00-1a2b3c4d5e6f"
 *               job_id:
 *                 type: string
 *                 example: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d"
 *               date_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2025-11-20T10:30:00Z"
 *               duration:
 *                 type: integer
 *                 example: 60
 *               zoom_link:
 *                 type: string
 *                 example: "https://zoom.us/j/123456789"
 *               phone_number:
 *                 type: string
 *                 example: "+2348012345678"
 *               notes:
 *                 type: string
 *                 example: "Please be on time."
 *     responses:
 *       201:
 *         description: Interview scheduled
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Failed to schedule interview
 */
router.post('/', authorize('admin', 'project_manager'), scheduleInterview);

/**
 * @swagger
 * /interviews:
 *   get:
 *     summary: List interviews (Admin/PM)
 *     tags:
 *       - Interviews
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum:
 *             - scheduled
 *             - completed
 *             - cancelled
 *             - rescheduled
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: OK
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Failed to fetch interviews
 */
router.get('/', authorize('admin', 'project_manager'), getAllInterviews);

/**
 * @swagger
 * /interviews/me:
 *   get:
 *     summary: Get my interviews (Engineer/PM)
 *     tags:
 *       - Interviews
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: OK
 *       403:
 *         description: Forbidden
 *       500:
 *         description: Failed to fetch interviews
 */
router.get('/me', getMyInterviews);

/**
 * @swagger
 * /interviews/{interviews_id}:
 *   get:
 *     summary: Get interview by ID (Admin/PM/Assigned Engineer)
 *     tags:
 *       - Interviews
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: interviews_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: OK
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Failed to fetch interview
 */
router.get('/:interviews_id', getInterviewById);

/**
 * @swagger
 * /interviews/{interviews_id}:
 *   patch:
 *     summary: Update interview (cancel/reschedule/complete)
 *     description: |
 *       - PM/Admin can reschedule and set any status.  
 *       - Engineer can only set status to **completed** or **cancelled** for their own interview.
 *     tags:
 *       - Interviews
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: interviews_id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 enum:
 *                   - scheduled
 *                   - completed
 *                   - cancelled
 *                   - rescheduled
 *               date_time:
 *                 type: string
 *                 format: date-time
 *               duration:
 *                 type: integer
 *               zoom_link:
 *                 type: string
 *               phone_number:
 *                 type: string
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Interview updated
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Not found
 *       500:
 *         description: Failed to update interview
 */
router.patch('/:interviews_id', updateInterview);

module.exports = router;
