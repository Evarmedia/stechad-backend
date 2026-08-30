const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin endpoints for platform management and oversight
 */

const { authenticate, authorize } = require('../middleware/auth');
const adminController = require('../controllers/adminController');
const { upload } = require('../middleware/upload');

const router = express.Router();

// All routes require authentication and admin role
router.use(authenticate, authorize('super_admin', 'admin'));

/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     summary: Get admin dashboard overview
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/dashboard', adminController.getDashboard);

/**
 * @swagger
 * /admin/stats:
 *   get:
 *     summary: Get platform statistics
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/stats', adminController.getStats);

/**
 * @swagger
 * /admin/profile:
 *   put:
 *     summary: Update admin profile (supports avatar upload). Returns a short-lived signed URL if a new avatar is uploaded.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *               is_super_admin:
 *                 type: boolean
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               phone_number:
 *                 type: string
 *               city:
 *                 type: string
 *               country:
 *                 type: string
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Avatar image file (optional). When uploaded, backend stores the GCS object name and returns a signed URL.
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
 *                   example: 'Profile updated successfully'
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
 *       404:
 *         description: Admin profile not found
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
router.put('/profile', upload.single('avatar'), adminController.updateProfile);

/**
 * @swagger
 * /admin/engineers/{engineer_id}:
 *   get:
 *     summary: Get specific engineer details
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: engineer_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Engineer details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/engineers/:engineer_id', adminController.getEngineerDetails);

/**
 * @swagger
 * /admin/engineers/toggle-vet:
 *   put:
 *     summary: Vet an engineer
 *     tags: [Admin]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               engineer_id:
 *                 type: string
 *                 example: enginer-id-ssishw
 *                 description: ID of the engineer to vet
 *               is_vetted:
 *                 type: boolean
 *                 example: true
 *               remark:
 *                 type: string
 *                 example: "Experienced but not Fluent in French"
 *                 description: Vetting status of the engineer
 *     responses:
 *       200:
 *         description: Engineer vetted successfully
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
 *                   example: Engineer vetted successfully
 *                 data:
 *                   $ref: '#/components/schemas/Engineer'
 *       404:
 *         description: Engineer not found
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Engineer not found
 *       500:
 *         description: Failed to vet engineer
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: Failed to vet engineer
 *                 error:
 *                   type: string
 *                   example: Error message
 */
router.put(
  "/engineers/toggle-vet",
  adminController.updateEngineerVetting
);

/**
 * @swagger
 * /admin/engineers/{engineer_id}:
 *   delete:
 *     summary: Delete engineer account
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: engineer_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Engineer deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.delete('/engineers/:engineer_id', adminController.deleteEngineer);

/**
 * @swagger
 * /admin/project-managers:
 *   get:
 *     summary: Get all project managers
 *     tags: [Admin]
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
 *         name: is_verified
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Project managers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/project-managers', adminController.getProjectManagers);

/**
 * @swagger
 * /admin/project-managers/invite:
 *   post:
 *     summary: Invite new project manager
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - first_name
 *               - last_name
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: mishakmanuel@gmail.com
 *               first_name:
 *                 type: string
 *                 example: Mishak
 *               last_name:
 *                 type: string
 *                 example: Mosi
 *     responses:
 *       201:
 *         description: Invitation sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.post('/project-managers/invite', adminController.inviteProjectManager);

/**
 * @swagger
 * /admin/project-managers/{project_managers_id}:
 *   get:
 *     summary: Get specific project manager details
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: project_managers_id
 *         required: true
 *         description: The UUID of the project manager
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Project manager details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Invalid project manager ID format. It must be a valid UUID.
 *       404:
 *         description: Project manager not found
 *       500:
 *         description: Internal server error
 */
router.get('/project-managers/:project_managers_id', adminController.getProjectManagerDetails);

/**
 * @swagger
 * /admin/project-managers/{project_managers_id}:
 *   delete:
 *     summary: Delete project manager account
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: project_managers_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Project manager deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.delete('/project-managers/:project_managers_id', adminController.deleteProjectManager);

/**
 * @swagger
 * /admin/engineer-vetting:
 *   get:
 *     summary: Get engineers pending vetting
 *     tags: [Admin]
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
 *     responses:
 *       200:
 *         description: Pending vetting engineers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/engineer-vetting', adminController.getEngineerVetting);

/**
 * @swagger
 * /admin/settings:
 *   get:
 *     summary: Get platform settings
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/workforce', adminController.getWorkforce);
router.post('/workforce/invite', adminController.inviteProjectManager);
router.put('/workforce/users/:user_id', adminController.updateWorkforceUser);
router.put('/workforce/approvals/:type/:request_id', adminController.reviewWorkforceApproval);
router.get('/departments', adminController.getDepartments);
router.post('/departments', adminController.createDepartment);
router.put('/departments/:department_id', adminController.updateDepartment);
router.delete('/departments/:department_id', adminController.deleteDepartment);
router.post('/holidays', adminController.createHoliday);
router.put('/holidays/:holiday_id', adminController.updateHoliday);
router.delete('/holidays/:holiday_id', adminController.deleteHoliday);
router.post('/kpis', adminController.createKpi);
router.put('/kpis/:kpi_id', adminController.updateKpi);
router.delete('/kpis/:kpi_id', adminController.deleteKpi);
router.post('/kpis/:kpi_id/appraisals', adminController.recordKpiAppraisal);
router.put('/role-permissions/:role_permission_id', adminController.updateRolePermission);

router.get('/settings', adminController.getSettings);

/**
 * @swagger
 * /admin/settings:
 *   put:
 *     summary: Update platform settings
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               settings:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.put('/settings', adminController.updateSettings);

module.exports = router;
