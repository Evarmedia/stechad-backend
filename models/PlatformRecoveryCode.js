const { DataTypes: D } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('PlatformRecoveryCode', {
  recovery_code_id: { type: D.UUID, primaryKey: true, defaultValue: D.UUIDV4 },
  user_id: { type: D.UUID, allowNull: false, references: { model: 'users', key: 'user_id' }, onDelete: 'CASCADE' },
  credential_version: { type: D.INTEGER, allowNull: false },
  code_hash: { type: D.STRING(64), allowNull: false, unique: true },
  consumed_at: { type: D.DATE, allowNull: true },
}, { tableName: 'platform_recovery_codes', createdAt: 'created_at', updatedAt: 'updated_at', indexes: [{ fields: ['user_id', 'credential_version'] }] });
