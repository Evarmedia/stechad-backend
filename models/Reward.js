const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User");

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

module.exports = {
  Reward
};