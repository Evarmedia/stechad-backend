const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Authentication
 *   description: User authentication and account management
 */

const {
  signup,
  login,
  logout,
  sendOtp,
  verifyEmail,
  resetPassword,
  editPassword,
  acceptInvites,
  getMe
} = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { validateRegistration, validateLogin } = require('../middleware/validation');

const passport = require('passport');
const { generateTokens } = require('../utils/generateTokens')

const router = express.Router();

/**
 * @swagger
 * /auth/google:
 *   get:
 *     summary: Redirect to Google OAuth for authentication
 *     tags: [Authentication]
 *     description: This route redirects the user to Google's OAuth 2.0 authentication page.
 *     responses:
 *       302:
 *         description: Redirects to Google OAuth page
 *         headers:
 *           Location:
 *             description: Redirect location to Google OAuth
 *             type: string
 *             example: 'https://accounts.google.com/o/oauth2/auth?scope=profile%20email&response_type=code&client_id=YOUR_GOOGLE_CLIENT_ID&redirect_uri=http://localhost:5000/auth/google/callback'
 *       400:
 *         description: Bad request if there is a problem with the OAuth initiation
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
 *                   example: 'Failed to initiate Google OAuth.'
 */
// Redirect to Google OAuth
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false,
  // Force Google to show the account chooser / consent screen
  prompt: 'select_account',
  accessType: 'offline',
}));

/**
 * @swagger
 * /auth/google/callback:
 *   get:
 *     summary: Google OAuth callback after authentication
 *     tags: [Authentication]
 *     description: This route handles the Google OAuth callback, exchanges the authorization code for a token, and sends the user a JWT token.
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         description: Authorization code received from Google
 *         schema:
 *           type: string
 *           example: '4/0AY0e_g5Vpz7hf2Z58Lw9LlvFw9nlpLoZd1fv-9h-lrhD5T6sQgd3cL_FyZVYHjMKlhS'
 *     responses:
 *       200:
 *         description: Successful authentication and token generation
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
 *                   example: "User logged in successfully"
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
 *       400:
 *         description: Failed authentication or invalid authorization code
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Google callback route
router.get('/google/callback', 
  passport.authenticate('google', { failureRedirect: '/', session: false }),
  (req, res) => {
    // Send JWT token after successful login or signup
    const { token } = generateTokens({
      user_id: req.user.user_id,
      role: req.user.role,
    });
    res.redirect(`http://localhost:8080/dashboard/engineer?token=${token}`);
  }
);

/**
 * @swagger
 * /auth/signup:
 *   post:
 *     summary: Register a new user account
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - confirm_password
 *               - firsst_name
 *               - last_name
 *               - role
 *               - googleSignIn
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: mosimishak@gmail.com
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: password123
 *               confirm_password:
 *                 type: string
 *                 minLength: 6
 *                 example: password123
 *               first_name:
 *                 type: string
 *                 example: Mishak
 *               last_name:
 *                 type: string
 *                 example: Mosimabale
 *               role:
 *                 type: string
 *                 enum: [engineer, project_manager, admin]
 *                 example: engineer
 *               referral_code:
 *                 type: string
 *                 description: Referral code (optional)
 *                 example: "ionX23"
 *               googleSignIn:
 *                 type: boolean
 *                 description: Sign up using Google OAuth
 *                 example: false
 *     responses:
 *       201:
 *         description: User registered successfully
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
 *                   example: User registered successfully
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       400:
 *         description: User already exists or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Registration failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// Public routes
router.post('/signup', validateRegistration, signup);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: User login for all roles
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: mosimishak@gmail.com
 *               password:
 *                 type: string
 *                 example: password123
 *     responses:
 *       200:
 *         description: Login successful
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
 *                   example: Login successful
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     token:
 *                       type: string
 *                       example: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
 *       401:
 *         description: Invalid credentials or account deactivated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Login failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/login', validateLogin, login);

/**
 * @swagger
 * /auth/send-otp:
 *   post:
 *     summary: Send OTP to user's email for password reset or email verification
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - purpose
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: mosimishak@gmail.com
 *               purpose:
 *                 type: string
 *                 enum: [password_reset, email_verification]
 *                 example: "password_reset"
 *     responses:
 *       200:
 *         description: OTP sent successfully
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
 *                   example: OTP sent to your email
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to send OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/send-otp', sendOtp);

/**
 * @swagger
 * /auth/verifyEmail:
 *   post:
 *     summary: Verify OTP code for password reset or email verification
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: mosimishak@gmail.com
 *               otp:
 *                 type: string
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: OTP verified successfully
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
 *                   example: OTP verified successfully
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: OTP verification failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/verify-email', verifyEmail);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Reset password with verified OTP
 *     tags: [Authentication]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - otp
 *               - new_password
 *               - confirm_password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: mosimishak@gmail.com
 *               otp:
 *                 type: string
 *                 example: "123456"
 *               new_password:
 *                 type: string
 *                 minLength: 6
 *                 example: newpassword123
 *               confirm_password:
 *                 type: string
 *                 minLength: 6
 *                 example: newpassword123
 *     responses:
 *       200:
 *         description: Password reset successful
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
 *                   example: Password reset successful
 *       400:
 *         description: Invalid or expired OTP
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Password reset failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/reset-password', resetPassword);

/**
 * @swagger
 * /auth/edit-password:
 *   post:
 *     summary: Edit password for authenticated users
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - old_password
 *               - new_password
 *               - confirm_password
 *             properties:
 *               old_password:
 *                 type: string
 *                 example: oldpassword123
 *               new_password:
 *                 type: string
 *                 minLength: 8
 *                 example: newpassword123
 *               confirm_password:
 *                 type: string
 *                 minLength: 8
 *                 example: newpassword123
 *     responses:
 *       200:
 *         description: Password updated successfully
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
 *                   example: Password updated successfully
 *       400:
 *         description: Current password is incorrect or validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Password update failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/edit-password', authenticate, editPassword);

/**
 * @swagger
 * /auth/accept-invite/{token}:
 *   post:
 *     summary: Accept an invite and register a new user
 *     tags: [Authentication]
 *     parameters:
 *       - in: path
 *         name: token
 *         schema:
 *           type: string
 *         required: true
 *         description: Invite token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               temp_password:
 *                 type: string
 *                 description: Temporary password
 *               new_password:
 *                 type: string
 *                 description: New password
 *                 example: "password123"
 *               confirm_password:
 *                 type: string
 *                 description: Confirm new password
 *                 example: "password123"
 *               first_name:
 *                 type: string
 *                 description: User's first name (optional)
 *                 example: "King Mosi"
 *               last_name:
 *                 type: string
 *                 example: "The third"
 *                 description: User's last name (optional)
 *     responses:
 *       201:
 *         description: Invite accepted and user registered successfully
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
 *                   example: Invite accepted and user registered successfully, Please Login
 *                 data:
 *                   type: object
 *                   properties:
 *                     user:
 *                       type: object
 *                       properties:
 *                         user_id:
 *                           type: integer
 *                         email:
 *                           type: string
 *                         first_name:
 *                           type: string
 *                         last_name:
 *                           type: string
 *                         role:
 *                           type: string
 *       400:
 *         description: Invalid or expired invite, or passwords do not match
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
 *                   example: Invalid or expired invite
 *       401:
 *         description: Temporary password is incorrect
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
 *                   example: Temporary password is incorrect
 *       500:
 *         description: Internal server error
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
 *                   example: Failed to accept invite
 */
router.post('/accept-invite/:token', acceptInvites);

// Protected routes
/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: User logout
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: Logout successful
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
 *                   example: Logout successful
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Logout failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post('/logout', authenticate, logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get current user profile
 *     tags: [Authentication]
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: Failed to get user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/me', authenticate, getMe);

module.exports = router;