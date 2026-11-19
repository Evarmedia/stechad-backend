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
      allowNull: true,
      references: {
        model: User,
        key: 'user_id',
      },
    },
    referee_id: {
      type: DataTypes.UUID,
      allowNull: true,
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

module.exports = {
  Referral
};