const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./User');

const ProjectManager = sequelize.define('ProjectManager', {
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
  company_name: {
    type: DataTypes.STRING,
    allowNull: true
  },
  company_size: {
    type: DataTypes.STRING,
    allowNull: true
  },
  industry: {
    type: DataTypes.STRING,
    allowNull: true
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  website_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  linkedin_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  location: {
    type: DataTypes.STRING,
    allowNull: true
  },
  timezone: {
    type: DataTypes.STRING,
    allowNull: true
  },
  is_verified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  verified_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  total_projects: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  total_hires: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

// Associations
ProjectManager.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasOne(ProjectManager, { foreignKey: 'user_id', as: 'project_manager' });

module.exports = ProjectManager;