const { User, Role, Referral, Reward, UserReward } = require('../models');
const { 
  getUserReferralStats, 
  getUserRewards, 
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
          model: User.unscoped(),
          as: 'referrer',
          attributes: ['first_name', 'last_name', 'role_id', 'avatar_object_name'],
          include: [{ model: Role, as: 'role', attributes: ['role_id', 'role_key', 'name'] }]
        }
      ],
      group: ['referrer_id', 'referrer.user_id', 'referrer->role.role_id'],
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

// Claim all eligible rewards for user
const claimReward = async (req, res) => {
  const transaction = await Reward.sequelize.transaction();
  
  try {
    const userRewards = await UserReward.findAll({
      where: {
        user_id: req.user.user_id,
        reward_status: 'approved'
      },
      include: [
        {
          model: Reward,
          attributes: ['reward_type', 'reward_description']
        }
      ],
      transaction
    });
    
    if (!userRewards || userRewards.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No eligible rewards found for claiming'
      });
    }

    let totalAmount = 0;
    const claimedRewards = [];
    const expiredRewards = [];

    // Process each reward
    for (const reward of userRewards) {
      // Check expiration
      if (reward.expires_at && new Date() > reward.expires_at) {
        await reward.update({ 
          reward_status: 'expired' 
        }, { transaction });
        expiredRewards.push(reward);
        continue;
      }

      // Update reward status
      await reward.update({
        reward_status: 'claimed',
        claimed_at: new Date()
      }, { transaction });

      totalAmount += parseFloat(reward.reward_amount);
      claimedRewards.push(reward);
    }

    await transaction.commit();

    // add reward to user.reward balance
    if (totalAmount > 0) {
      await User.increment(
        { reward: totalAmount },
        { where: { user_id: req.user.user_id } }
      );
    }

    // Send notification after transaction commits
    if (claimedRewards.length > 0) {
      await createNotification({
        user_id: req.user.user_id,
        title: 'Rewards Claimed!',
        message: `You have successfully claimed ${claimedRewards.length} rewards totaling $${totalAmount.toFixed(2)}!`,
        type: 'success',
        metadata: {
          claimed_count: claimedRewards.length,
          total_amount: totalAmount,
          claimed_rewards: claimedRewards.map(r => ({
            id: r.user_reward_id,
            amount: r.reward_amount
          }))
        }
      });
    }

    res.json({
      success: true,
      message: `Successfully processed rewards`,
      data: {
        claimed_rewards: claimedRewards,
        expired_rewards: expiredRewards,
        total_amount: totalAmount.toFixed(2),
        claims_processed: claimedRewards.length,
        expired_count: expiredRewards.length
      }
    });

  } catch (error) {
    await transaction.rollback();
    res.status(500).json({
      success: false,
      message: 'Failed to claim rewards',
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
    
    // Total rewards claimed
    const totalRewardsclaimed = await UserReward.sum('reward_amount', {
      where: { reward_status: 'claimed' }
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
          model: User.unscoped(),
          as: 'referrer',
          attributes: ['first_name', 'last_name', 'role_id'],
          include: [{ model: Role, as: 'role', attributes: ['role_id', 'role_key', 'name'] }]
        }
      ],
      group: ['referrer_id', 'referrer.user_id', 'referrer->role.role_id'],
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
        total_rewards_claimed: totalRewardsclaimed || 0,
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
  getReferralLeaderboard,
  claimReward,
  getReferralAnalytics
};
