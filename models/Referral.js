const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User");

class Referral extends Model {}

Referral.init(
  {
    referral_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    referrer_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'user_id',
      },
    },
    referee_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'user_id',
      },
    },
    referral_code: {
      type: DataTypes.STRING(10),
      allowNull: false,
      // unique: true,
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'expired'),
      defaultValue: 'pending',
    },
    reward_claimed: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    completed_at: {
      type: DataTypes.DATE,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "Referral",
    tableName: "referrals",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

class Reward extends Model {}

Reward.init(
  {
    reward_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    reward_type: {
      type: DataTypes.ENUM('referral', 'signup', 'milestone', 'bonus'),
      allowNull: false,
    },
    reward_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    reward_currency: {
      type: DataTypes.STRING(3),
      defaultValue: 'USD',
    },
    reward_description: {
      type: DataTypes.TEXT,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "Reward",
    tableName: "rewards",
    timestamps: true, 
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

class UserReward extends Model {}

UserReward.init(
  {
    user_reward_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'user_id',
      },
    },
    reward_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Reward,
        key: 'reward_id',
      },
    },
    referral_id: {
      type: DataTypes.UUID,
      references: {
        model: Referral,
        key: 'referral_id',
      },
    },
    reward_status: {
      type: DataTypes.ENUM('pending', 'approved', 'paid', 'expired'),
      defaultValue: 'pending',
    },
    reward_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
    },
    claimed_at: {
      type: DataTypes.DATE,
    },
    expires_at: {
      type: DataTypes.DATE,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "UserReward",
    tableName: "user_rewards",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = {
  Referral,
  Reward,
  UserReward,
};