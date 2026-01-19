const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User");
const { Reward } = require("./Reward");
const { Referral } = require("./Referral");


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
      type: DataTypes.ENUM('pending', 'approved', 'claimed', 'expired'),
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
  UserReward
};