const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User"); // Import User model for relationship

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
    reward_status: {
      type: DataTypes.ENUM('pending', 'claimed', 'expired'),
      defaultValue: 'pending',
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
      type: DataTypes.ENUM('referral', 'signup', 'milestone'),
      allowNull: false,
    },
    reward_amount: {
      type: DataTypes.FLOAT,
      allowNull: false,
    },
    reward_description: {
      type: DataTypes.TEXT,
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
    reward_status: {
      type: DataTypes.ENUM('unclaimed', 'claimed', 'expired'),
      defaultValue: 'unclaimed',
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
