const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('IdentityAuditLog', {
  audit_log_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  actor_user_id: { type: DataTypes.UUID, allowNull: true },
  actor_name: { type: DataTypes.TEXT, allowNull: true },
  action: { type: DataTypes.TEXT, allowNull: false },
  target_type: { type: DataTypes.TEXT, allowNull: false },
  target_id: { type: DataTypes.TEXT, allowNull: true },
  outcome: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'success' },
  changes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'identity_audit_logs', timestamps: false, indexes: [{ fields: ['actor_user_id', 'occurred_at'] }] });
