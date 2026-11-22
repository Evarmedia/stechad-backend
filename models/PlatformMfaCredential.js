const { DataTypes: D } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('PlatformMfaCredential', {
  credential_id: { type: D.UUID, primaryKey: true, defaultValue: D.UUIDV4 },
  user_id: { type: D.UUID, allowNull: false, unique: true, references: { model: 'users', key: 'user_id' }, onDelete: 'CASCADE' },
  encrypted_secret: { type: D.TEXT, allowNull: true },
  pending_encrypted_secret: { type: D.TEXT, allowNull: true },
  pending_expires_at: { type: D.DATE, allowNull: true },
  pending_session_id: { type: D.UUID, allowNull: true },
  pending_reason: { type: D.TEXT, allowNull: true },
  credential_version: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
  last_timestep: { type: D.BIGINT, allowNull: true },
  failed_attempts: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
  locked_until: { type: D.DATE, allowNull: true },
}, { tableName: 'platform_mfa_credentials', createdAt: 'created_at', updatedAt: 'updated_at', indexes: [] });
