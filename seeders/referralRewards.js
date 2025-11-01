const { Reward } = require('../models');
const { v4: uuidv4 } = require('uuid');

const createDefaultRewards = async () => {
  try {
    // Create default referral reward
    await Reward.create({
      reward_id: uuidv4(),
      reward_type: 'referral',
      reward_amount: 50.00, // $50 for referrer
      reward_currency: 'USD',
      reward_description: 'Standard referral reward for bringing new users',
      is_active: true
    });

    // Create signup reward
    await Reward.create({
      reward_id: uuidv4(),
      reward_type: 'signup',
      reward_amount: 25.00, // $25 for referee (signup bonus)
      reward_currency: 'USD', 
      reward_description: 'Welcome bonus for signing up with referral',
      is_active: true
    });

    console.log('Default rewards created successfully');
  } catch (error) {
    console.error('Error creating default rewards:', error);
    throw error;
  }
};

module.exports = createDefaultRewards;