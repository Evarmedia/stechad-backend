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
 *               date_of_birth:
 *                 $ref: '#/components/schemas/Birthday'
 *               avatar:
 *                 type: string
 *                 format: binary
 *                 description: Avatar image file (optional). When uploaded, backend stores the GCS object name and returns a signed URL.
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
 * /admin/talents/{talent_id}:
 *   get:
 *     summary: Get specific talent details
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: talent_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Talent details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/talents/:talent_id', adminController.getTalentDetails);

/**
 * @swagger
 * /admin/talents/toggle-vet:
 *   put:
 *     summary: Vet a talent
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
 *               talent_id:
 *                 type: string
 *                 example: enginer-id-ssishw
 *                 description: ID of the talent to vet
 *               is_vetted:
 *                 type: boolean
 *                 example: true
 *               remark:
 *                 type: string
 *                 example: "Experienced but not Fluent in French"
 *                 description: Vetting status of the talent
 *     responses:
 *       200:
 *         description: Talent vetted successfully
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
 *                   example: Talent vetted successfully
 *                 data:
 *                   $ref: '#/components/schemas/Talent'
 *       404:
 *         description: Talent not found
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
 *                   example: Talent not found
 *       500:
 *         description: Failed to vet talent
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
 *                   example: Failed to vet talent
 *                 error:
 *                   type: string
 *                   example: Error message
 */
router.put(
  "/talents/toggle-vet",
  adminController.updateTalentVetting
);

/**
 * @swagger
 * /admin/talents/{talent_id}:
 *   delete:
 *     summary: Delete talent account
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: talent_id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Talent deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.delete('/talents/:talent_id', adminController.deleteTalent);

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
 * /admin/talent-vetting:
 *   get:
 *     summary: Get talents pending vetting
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
 *         description: Pending vetting talents retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 */
router.get('/talent-vetting', adminController.getTalentVetting);

/**
 * @swagger
 * /admin/settings:
 *   get:
 *     summary: Get platform settings
 *     description: Admin-only settings. EMPLOYEE_ID_PREFIX defaults to STE when not configured.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Settings retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   $ref: '#/components/schemas/PlatformSettings'
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
router.get('/roles', authorize('super_admin'), adminController.getRoles);
router.post('/roles', authorize('super_admin'), adminController.createRole);
router.put('/roles/:role_id', authorize('super_admin'), adminController.updateRole);
router.delete('/roles/:role_id', authorize('super_admin'), adminController.deleteRole);

router.get('/settings', adminController.getSettings);

/**
 * @swagger
 * /admin/settings:
 *   put:
 *     summary: Update platform settings
 *     description: Admin-only settings update. EMPLOYEE_ID_PREFIX applies only to newly generated employee IDs; existing and reserved IDs are preserved.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [settings]
 *             properties:
 *               settings:
 *                 $ref: '#/components/schemas/PlatformSettings'
 *     responses:
 *       200:
 *         description: Settings updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Success'
 *       400:
 *         description: Invalid settings object or employee ID prefix.
 *       403:
 *         description: Admin access required.
 */
router.put('/settings', adminController.updateSettings);

module.exports = router;
