const { User, Referral, Reward, UserReward } = require('../models');
const { 
  getUserReferralStats, 
  getUserRewards, 
  completeReferral,
  validateReferralCode 
} = require('../utils/referralUtil');
const { createNotification } = require('../utils/notificationUtil');

// Get user's referral dashboard
const getReferralDashboard = async (req, res) => {
  try {
    const stats = await getUserReferralStats(req.user.user_id);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get referral dashboard',
      error: error.message
    });
  }
};

// Get user's reward history
const getRewardHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const rewards = await getUserRewards(req.user.user_id, {
      page,
      limit,
      status
    });
    
    res.json({
      success: true,
      data: rewards
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get reward history',
      error: error.message
    });
  }
};

// Validate referral code
const validateReferral = async (req, res) => {
  try {
    const { referral_code } = req.params;
    
    const isValid = await validateReferralCode(referral_code);
    
    if (isValid) {
      const referrer = await User.findOne({
        where: { referral_code },
        attributes: ['first_name', 'last_name', 'role']
      });
      
      res.json({
        success: true,
        data: {
          valid: true,
          referrer: referrer
        }
      });
    } else {
      res.json({
        success: true,
        data: {
          valid: false
        }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to validate referral code',
      error: error.message
    });
  }
};

// Get referral leaderboard (admin only)
const getReferralLeaderboard = async (req, res) => {
  try {
    const { page = 1, limit = 20, period = 'all' } = req.query;
    const offset = (page - 1) * limit;
    
    let dateFilter = {};
    if (period !== 'all') {
      const now = new Date();
      switch (period) {
        case 'month':
          dateFilter.created_at = {
            [require('sequelize').Op.gte]: new Date(now.getFullYear(), now.getMonth(), 1)
          };
          break;
        case 'quarter':
          const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
          dateFilter.created_at = {
            [require('sequelize').Op.gte]: quarterStart
          };
          break;
        case 'year':
          dateFilter.created_at = {
            [require('sequelize').Op.gte]: new Date(now.getFullYear(), 0, 1)
          };
          break;
      }
    }
    
    const leaderboard = await Referral.findAll({
      where: dateFilter,
      attributes: [
        'referrer_id',
        [Referral.sequelize.fn('COUNT', Referral.sequelize.col('referral_id')), 'total_referrals'],
        [Referral.sequelize.fn('COUNT', Referral.sequelize.literal("CASE WHEN status = 'completed' THEN 1 END")), 'completed_referrals']
      ],
      include: [
        {
          model: User,
          as: 'referrer',
          attributes: ['first_name', 'last_name', 'role', 'avatar_url']
        }
      ],
      group: ['referrer_id', 'referrer.user_id'],
      order: [[Referral.sequelize.fn('COUNT', Referral.sequelize.col('referral_id')), 'DESC']],
      limit: parseInt(limit),
      offset: parseInt(offset)
    });
    
    res.json({
      success: true,
      data: {
        leaderboard,
        pagination: {
          currentPage: parseInt(page),
          itemsPerPage: parseInt(limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get referral leaderboard',
      error: error.message
    });
  }
};

// Complete referral (admin only)
const completeReferralById = async (req, res) => {
  try {
    const { referral_id } = req.params;
    
    const referral = await completeReferral(referral_id);
    
    res.json({
      success: true,
      message: 'Referral completed successfully',
      data: referral
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to complete referral',
      error: error.message
    });
  }
};

// Claim reward
const claimReward = async (req, res) => {
  try {
    const { reward_id } = req.params;
    
    const userReward = await UserReward.findOne({
      where: {
        user_reward_id: reward_id,
        user_id: req.user.user_id,
        reward_status: 'approved'
      },
      include: [
        {
          model: Reward,
          attributes: ['reward_type', 'reward_description']
        }
      ]
    });
    
    if (!userReward) {
      return res.status(404).json({
        success: false,
        message: 'Reward not found or not eligible for claiming'
      });
    }
    
    // Check if reward has expired
    if (userReward.expires_at && new Date() > userReward.expires_at) {
      await userReward.update({ reward_status: 'expired' });
      return res.status(400).json({
        success: false,
        message: 'Reward has expired'
      });
    }
    
    await userReward.update({
      reward_status: 'paid',
      claimed_at: new Date()
    });
    
    // Create notification
    await createNotification({
      user_id: req.user.user_id,
      title: 'Reward Claimed!',
      message: `You have successfully claimed your $${userReward.reward_amount} reward!`,
      type: 'success',
      metadata: {
        reward_id: userReward.user_reward_id,
        amount: userReward.reward_amount
      }
    });
    
    res.json({
      success: true,
      message: 'Reward claimed successfully',
      data: userReward
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to claim reward',
      error: error.message
    });
  }
};

// Get referral analytics (admin only)
const getReferralAnalytics = async (req, res) => {
  try {
    const { period = 'month' } = req.query;
    
    let dateFilter;
    const now = new Date();
    
    switch (period) {
      case 'week':
        dateFilter = { [require('sequelize').Op.gte]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) };
        break;
      case 'month':
        dateFilter = { [require('sequelize').Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
        break;
      case 'quarter':
        dateFilter = { [require('sequelize').Op.gte]: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) };
        break;
      case 'year':
        dateFilter = { [require('sequelize').Op.gte]: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000) };
        break;
      default:
        dateFilter = { [require('sequelize').Op.gte]: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) };
    }
    
    // Total referrals
    const totalReferrals = await Referral.count();
    const newReferrals = await Referral.count({
      where: { created_at: dateFilter }
    });
    
    // Completed referrals
    const completedReferrals = await Referral.count({
      where: { status: 'completed' }
    });
    
    // Total rewards paid
    const totalRewardsPaid = await UserReward.sum('reward_amount', {
      where: { reward_status: 'paid' }
    });
    
    // Conversion rate
    const conversionRate = totalReferrals > 0 ? (completedReferrals / totalReferrals * 100).toFixed(2) : 0;
    
    // Top referrers
    const topReferrers = await Referral.findAll({
      attributes: [
        'referrer_id',
        [Referral.sequelize.fn('COUNT', Referral.sequelize.col('referral_id')), 'referral_count']
      ],
      include: [
        {
          model: User,
          as: 'referrer',
          attributes: ['first_name', 'last_name', 'role']
        }
      ],
      group: ['referrer_id', 'referrer.user_id'],
      order: [[Referral.sequelize.fn('COUNT', Referral.sequelize.col('referral_id')), 'DESC']],
      limit: 10
    });
    
    res.json({
      success: true,
      data: {
        period,
        total_referrals: totalReferrals,
        new_referrals: newReferrals,
        completed_referrals: completedReferrals,
        total_rewards_paid: totalRewardsPaid || 0,
        conversion_rate: parseFloat(conversionRate),
        top_referrers: topReferrers
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get referral analytics',
      error: error.message
    });
  }
};

module.exports = {
  getReferralDashboard,
  getRewardHistory,
  validateReferral,
  getReferralLeaderboard,
  completeReferralById,
  claimReward,
  getReferralAnalytics
};