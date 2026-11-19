const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
class NotificationBroadcast extends Model {}
NotificationBroadcast.init({
  broadcast_id: { type: DataTypes.UUID, primaryKey: true },
  created_by: { type: DataTypes.UUID, allowNull: false },
  title: { type: DataTypes.TEXT, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  type: { type: DataTypes.STRING, allowNull: false },
  recipient_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { sequelize, modelName: "NotificationBroadcast", tableName: "notification_broadcasts", timestamps: false });
module.exports = NotificationBroadcast;
