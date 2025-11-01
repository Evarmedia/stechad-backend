const { User, Referral, Reward, UserReward, sequelize } = require('../models');
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
  const transaction = await sequelize.transaction();
  
  try {
    // Find the referrer
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

    // Create the referral record (already completed)
    const referral = await Referral.create({
      referrer_id: referrer.user_id,
      referee_id: refereeId,
      referral_code: referrerCode,
      status: 'completed',
      completed_at: new Date()
    }, { transaction });

    // Update the referee's referred_by field
    await User.update(
      { referred_by: referrer.user_id },
      { 
        where: { user_id: refereeId },
        transaction 
      }
    );

    // Get active rewards
    const referralRewards = await Reward.findAll({
      where: {
        reward_type: ['referral', 'signup'],
        is_active: true
      }
    });

    // Create approved rewards immediately for both users
    for (const reward of referralRewards) {
      if (reward.reward_type === 'referral') {
        // Create referrer reward (approved immediately)
        await UserReward.create({
          user_id: referrer.user_id,
          reward_id: reward.reward_id,
          referral_id: referral.referral_id,
          reward_amount: reward.reward_amount,
          reward_status: 'approved',
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        }, { transaction });

        // Notify referrer
        await createNotification({
          user_id: referrer.user_id,
          title: 'Referral Reward Earned!',
          message: `You've earned $${reward.reward_amount} for your successful referral!`,
          type: 'success',
          action_url: '/rewards',
          metadata: {
            referral_id: referral.referral_id,
            reward_amount: reward.reward_amount
          }
        });
      } else if (reward.reward_type === 'signup') {
        // Create referee reward (approved immediately)
        const refereeAmount = reward.reward_amount;
        await UserReward.create({
          user_id: refereeId,
          reward_id: reward.reward_id,
          referral_id: referral.referral_id,
          reward_amount: refereeAmount,
          reward_status: 'approved',
          expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
        }, { transaction });

        // Notify referee
        await createNotification({
          user_id: refereeId,
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
    }

    await transaction.commit();
    return referral;

  } catch (error) {
    await transaction.rollback();
    console.error('Error creating referral:', error);
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
  getUserReferralStats,
  validateReferralCode,
  getUserRewards
};