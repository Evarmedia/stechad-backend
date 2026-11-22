const { DataTypes: D } = require('sequelize');
const sequelize = require('../config/database');
module.exports = sequelize.define('PlatformRole', {
  role_id: { type: D.UUID, primaryKey: true },
  role_key: { type: D.STRING(60), allowNull: false, unique: true },
  name: { type: D.STRING(100), allowNull: false },
}, { tableName: 'platform_roles', createdAt: 'created_at', updatedAt: 'updated_at', indexes: [] });
