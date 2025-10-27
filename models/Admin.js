const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./User');

const Admin = sequelize.define('Admin', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  },
  permissions: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const value = this.getDataValue('permissions');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('permissions', JSON.stringify(value));
    }
  },
  is_super_admin: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

// Associations
Admin.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasOne(Admin, { foreignKey: 'user_id', as: 'admin' });

module.exports = Admin;