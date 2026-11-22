const { DataTypes: D } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('PlatformSessionAssurance', {
  session_id: { type: D.UUID, primaryKey: true, references: { model: 'auth_sessions', key: 'session_id' }, onDelete: 'CASCADE' },
  user_id: { type: D.UUID, allowNull: false, references: { model: 'users', key: 'user_id' }, onDelete: 'CASCADE' },
  credential_version: { type: D.INTEGER, allowNull: false },
  verified_at: { type: D.DATE, allowNull: false },
  expires_at: { type: D.DATE, allowNull: false },
}, { tableName: 'platform_session_assurances', createdAt: 'created_at', updatedAt: 'updated_at', indexes: [{ fields: ['user_id'] }, { fields: ['expires_at'] }] });
