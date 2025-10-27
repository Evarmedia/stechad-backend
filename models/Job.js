const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./User');

const Job = sequelize.define('Job', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  requirements: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const value = this.getDataValue('requirements');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('requirements', JSON.stringify(value));
    }
  },
  skills_required: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const value = this.getDataValue('skills_required');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('skills_required', JSON.stringify(value));
    }
  },
  budget_min: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  budget_max: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  budget_type: {
    type: DataTypes.ENUM('hourly', 'fixed', 'negotiable'),
    defaultValue: 'hourly'
  },
  duration: {
    type: DataTypes.STRING,
    allowNull: true
  },
  location: {
    type: DataTypes.STRING,
    allowNull: true
  },
  remote_allowed: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  experience_level: {
    type: DataTypes.ENUM('entry', 'intermediate', 'senior', 'expert'),
    defaultValue: 'intermediate'
  },
  job_type: {
    type: DataTypes.ENUM('full_time', 'part_time', 'contract', 'freelance'),
    defaultValue: 'contract'
  },
  status: {
    type: DataTypes.ENUM('draft', 'open', 'closed', 'in_progress', 'completed'),
    defaultValue: 'draft'
  },
  posted_by: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  },
  deadline: {
    type: DataTypes.DATE,
    allowNull: true
  },
  applications_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  views_count: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

// Associations
Job.belongsTo(User, { foreignKey: 'posted_by', as: 'poster' });
User.hasMany(Job, { foreignKey: 'posted_by', as: 'posted_jobs' });

module.exports = Job;