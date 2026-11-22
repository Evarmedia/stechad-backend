const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

module.exports = sequelize.define('StoredFile', {
  file_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  organization_id: { type: DataTypes.UUID, allowNull: false },
  owner_user_id: { type: DataTypes.UUID, allowNull: false },
  object_name: { type: DataTypes.TEXT, allowNull: false, unique: true },
  purpose: { type: DataTypes.STRING(50), allowNull: false },
  created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { tableName: 'stored_files', timestamps: false, indexes: [{ fields: ['organization_id', 'owner_user_id'] }] });
