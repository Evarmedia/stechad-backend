const { User, Referral, Reward, UserReward } = require('../models');
const { createNotification } = require('./notificationUtil');

/**
 * Generate a unique referral code
 * @returns {string} Unique referral code
 */
const generateReferralCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Create a referral record when a user signs up with a referral code
 * @param {string} referrerCode - The referral code used
 * @param {string} refereeId - The new user's ID
 * @returns {Promise<Object>} The created referral record
 */
const createReferral = async (referrerCode, refereeId) => {
  try {
    // Find the referrer by their referral code
    const referrer = await User.findOne({
      where: { referral_code: referrerCode }
    });

    if (!referrer) {
      throw new Error('Invalid referral code');
    }

    // Check if referee already has a referral
    const existingReferral = await Referral.findOne({
      where: { referee_id: refereeId }
    });

    if (existingReferral) {
      throw new Error('User already has a referral');
    }

    // Create the referral record
    const referral = await Referral.create({
      referrer_id: referrer.user_id,
      referee_id: refereeId,
      referral_code: referrerCode,
      status: 'pending'
    });

    // Update the referee's referred_by field
    await User.update(
      { referred_by: referrer.user_id },
      { where: { user_id: refereeId } }
    );

    // Create notification for referrer
    await createNotification({
      user_id: referrer.user_id,
      title: 'New Referral',
      message: 'Someone signed up using your referral code!',
      type: 'success',
      metadata: {
        referral_id: referral.referral_id,
        referee_id: refereeId
      }
    });

    return referral;
  } catch (error) {
    console.error('Error creating referral:', error);
    throw error;
  }
};

/**
 * Complete a referral and award rewards
 * @param {string} referralId - The referral ID to complete
 * @returns {Promise<Object>} The updated referral with rewards
 */
const completeReferral = async (referralId) => {
  try {
    const referral = await Referral.findByPk(referralId, {
      include: [
        { model: User, as: 'referrer' },
        { model: User, as: 'referee' }
      ]
    });

    if (!referral) {
      throw new Error('Referral not found');
    }

    if (referral.status === 'completed') {
      throw new Error('Referral already completed');
    }

    // Update referral status
    await referral.update({
      status: 'completed',
      completed_at: new Date()
    });

    // Get active referral rewards
    const referralRewards = await Reward.findAll({
      where: {
        reward_type: 'referral',
        is_active: true
      }
    });

    // Award rewards to both referrer and referee
    for (const reward of referralRewards) {
      // Award to referrer
      await UserReward.create({
        user_id: referral.referrer_id,
        reward_id: reward.reward_id,
        referral_id: referral.referral_id,
        reward_amount: reward.reward_amount,
        reward_status: 'approved',
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
      });

      // Award to referee (usually smaller amount)
      const refereeAmount = reward.reward_amount * 0.5; // 50% of referrer reward
      await UserReward.create({
        user_id: referral.referee_id,
        reward_id: reward.reward_id,
        referral_id: referral.referral_id,
        reward_amount: refereeAmount,
        reward_status: 'approved',
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
      });

      // Notify referrer
      await createNotification({
        user_id: referral.referrer_id,
        title: 'Referral Reward Earned!',
        message: `You've earned $${reward.reward_amount} for your successful referral!`,
        type: 'success',
        action_url: '/rewards',
        metadata: {
          referral_id: referral.referral_id,
          reward_amount: reward.reward_amount
        }
      });

      // Notify referee
      await createNotification({
        user_id: referral.referee_id,
        title: 'Welcome Bonus!',
        message: `You've earned $${refereeAmount} as a welcome bonus!`,
        type: 'success',
        action_url: '/rewards',
        metadata: {
          referral_id: referral.referral_id,
          reward_amount: refereeAmount
        }
      });
    }

    return referral;
  } catch (error) {
    console.error('Error completing referral:', error);
    throw error;
  }
};

/**
 * Get user's referral statistics
 * @param {string} userId - The user's ID
 * @returns {Promise<Object>} Referral statistics
 */
const getUserReferralStats = async (userId) => {
  try {
    const user = await User.findByPk(userId);
    if (!user) {
      throw new Error('User not found');
    }

    // Get referrals made by this user
    const referralsMade = await Referral.count({
      where: { referrer_id: userId }
    });

    const completedReferrals = await Referral.count({
      where: { 
        referrer_id: userId,
        status: 'completed'
      }
    });

    // Get total rewards earned
    const totalRewards = await UserReward.sum('reward_amount', {
      where: { 
        user_id: userId,
        reward_status: ['approved', 'paid']
      }
    });

    // Get pending rewards
    const pendingRewards = await UserReward.sum('reward_amount', {
      where: { 
        user_id: userId,
        reward_status: 'pending'
      }
    });

    // Get recent referrals
    const recentReferrals = await Referral.findAll({
      where: { referrer_id: userId },
      include: [
        { 
          model: User, 
          as: 'referee',
          attributes: ['first_name', 'last_name', 'email']
        }
      ],
      order: [['created_at', 'DESC']],
      limit: 5
    });

    return {
      referral_code: user.referral_code,
      referrals_made: referralsMade,
      completed_referrals: completedReferrals,
      total_rewards: totalRewards || 0,
      pending_rewards: pendingRewards || 0,
      recent_referrals: recentReferrals
    };
  } catch (error) {
    console.error('Error getting referral stats:', error);
    throw error;
  }
};

/**
 * Validate referral code
 * @param {string} referralCode - The referral code to validate
 * @returns {Promise<boolean>} Whether the code is valid
 */
const validateReferralCode = async (referralCode) => {
  try {
    const user = await User.findOne({
      where: { referral_code: referralCode }
    });
    return !!user;
  } catch (error) {
    console.error('Error validating referral code:', error);
    return false;
  }
};

/**
 * Get user's reward history
 * @param {string} userId - The user's ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated reward history
 */
const getUserRewards = async (userId, options = {}) => {
  try {
    const {
      page = 1,
      limit = 10,
      status
    } = options;

    const offset = (page - 1) * limit;
    let where = { user_id: userId };

    if (status) {
      where.reward_status = status;
    }

    const rewards = await UserReward.findAndCountAll({
      where,
      include: [
        {
          model: Reward,
          attributes: ['reward_type', 'reward_description']
        },
        {
          model: Referral,
          as: 'referral',
          include: [
            {
              model: User,
              as: 'referee',
              attributes: ['first_name', 'last_name']
            }
          ]
        }
      ],
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['created_at', 'DESC']]
    });

    return {
      rewards: rewards.rows,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(rewards.count / limit),
        totalItems: rewards.count,
        itemsPerPage: parseInt(limit)
      }
    };
  } catch (error) {
    console.error('Error getting user rewards:', error);
    throw error;
  }
};

module.exports = {
  generateReferralCode,
  createReferral,
  completeReferral,
  getUserReferralStats,
  validateReferralCode,
  getUserRewards
};