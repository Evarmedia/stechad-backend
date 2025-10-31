const express = require('express');
/**
 * @swagger
 * tags:
 *   name: Referrals
 *   description: Referral system endpoints for managing referrals and rewards
 */

const { authenticate, authorize } = require('../middleware/auth');
const {
  getReferralDashboard,
  getRewardHistory,
  validateReferral,
  getReferralLeaderboard,
  completeReferralById,
  claimReward,
  getReferralAnalytics
} = require('../controllers/referralController');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

/**
 * @swagger
 * /referrals/dashboard:
 *   get:
 *     summary: Get user's referral dashboard with statistics
 *     tags: [Referrals]
 *     responses:
 *       200:
 *         description: Referral dashboard retrieved successfully
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
 *                     referral_code:
 *                       type: string
 *                       example: "ABC12345"
 *                     referrals_made:
 *                       type: integer
 *                       example: 5
 *                     completed_referrals:
 *                       type: integer
 *                       example: 3
 *                     total_rewards:
 *                       type: number
 *                       example: 150.00
 *                     pending_rewards:
 *                       type: number
 *                       example: 50.00
 *                     recent_referrals:
 *                       type: array
 *                       items:
 *                         type: object
 */
router.get('/dashboard', getReferralDashboard);

/**
 * @swagger
 * /referrals/rewards:
 *   get:
 *     summary: Get user's reward history
 *     tags: [Referrals]
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
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, paid, expired]
 *     responses:
 *       200:
 *         description: Reward history retrieved successfully
 */
router.get('/rewards', getRewardHistory);

/**
 * @swagger
 * /referrals/validate/{referral_code}:
 *   get:
 *     summary: Validate a referral code
 *     tags: [Referrals]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: referral_code
 *         required: true
 *         schema:
 *           type: string
 *         description: Referral code to validate
 *     responses:
 *       200:
 *         description: Referral code validation result
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
 *                     valid:
 *                       type: boolean
 *                       example: true
 *                     referrer:
 *                       type: object
 *                       properties:
 *                         first_name:
 *                           type: string
 *                         last_name:
 *                           type: string
 *                         role:
 *                           type: string
 */
router.get('/validate/:referral_code', validateReferral);

/**
 * @swagger
 * /referrals/rewards/{reward_id}/claim:
 *   post:
 *     summary: Claim a reward
 *     tags: [Referrals]
 *     parameters:
 *       - in: path
 *         name: reward_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Reward ID to claim
 *     responses:
 *       200:
 *         description: Reward claimed successfully
 *       404:
 *         description: Reward not found or not eligible
 *       400:
 *         description: Reward has expired
 */
router.post('/rewards/:reward_id/claim', claimReward);

// Admin only routes
/**
 * @swagger
 * /referrals/leaderboard:
 *   get:
 *     summary: Get referral leaderboard (Admin only)
 *     tags: [Referrals]
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
 *           default: 20
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [all, month, quarter, year]
 *           default: all
 *     responses:
 *       200:
 *         description: Leaderboard retrieved successfully
 */
router.get('/leaderboard', authorize('admin'), getReferralLeaderboard);

/**
 * @swagger
 * /referrals/{referral_id}/complete:
 *   post:
 *     summary: Complete a referral and award rewards (Admin only)
 *     tags: [Referrals]
 *     parameters:
 *       - in: path
 *         name: referral_id
 *         required: true
 *         schema:
 *           type: string
 *         description: Referral ID to complete
 *     responses:
 *       200:
 *         description: Referral completed successfully
 *       404:
 *         description: Referral not found
 *       400:
 *         description: Referral already completed
 */
router.post('/:referral_id/complete', authorize('admin'), completeReferralById);

/**
 * @swagger
 * /referrals/analytics:
 *   get:
 *     summary: Get referral analytics (Admin only)
 *     tags: [Referrals]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [week, month, quarter, year]
 *           default: month
 *     responses:
 *       200:
 *         description: Analytics retrieved successfully
 */
router.get('/analytics', authorize('admin'), getReferralAnalytics);

module.exports = router;