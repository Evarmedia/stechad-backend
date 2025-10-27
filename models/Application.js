const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./User');
const Job = require('./Job');

const Application = sequelize.define('Application', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  job_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: Job,
      key: 'id'
    }
  },
  engineer_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
      key: 'id'
    }
  },
  cover_letter: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  proposed_rate: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  availability: {
    type: DataTypes.STRING,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('pending', 'reviewed', 'shortlisted', 'rejected', 'hired'),
    defaultValue: 'pending'
  },
  reviewed_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  reviewed_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  feedback: {
    type: DataTypes.TEXT,
    allowNull: true
  }
});

// Associations
Application.belongsTo(Job, { foreignKey: 'job_id', as: 'job' });
Application.belongsTo(User, { foreignKey: 'engineer_id', as: 'engineer' });
Application.belongsTo(User, { foreignKey: 'reviewed_by', as: 'reviewer' });

Job.hasMany(Application, { foreignKey: 'job_id', as: 'applications' });
User.hasMany(Application, { foreignKey: 'engineer_id', as: 'applications' });

module.exports = Application;