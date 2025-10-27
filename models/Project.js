const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./User');
const Job = require('./Job');

const Project = sequelize.define('Project', {
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
    allowNull: true
  },
  job_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: Job,
      key: 'id'
    }
  },
  client_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: User,
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
  status: {
    type: DataTypes.ENUM('planning', 'in_progress', 'review', 'completed', 'cancelled'),
    defaultValue: 'planning'
  },
  budget: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: true
  },
  start_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  end_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  actual_end_date: {
    type: DataTypes.DATE,
    allowNull: true
  },
  progress: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0,
      max: 100
    }
  },
  milestones: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const value = this.getDataValue('milestones');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('milestones', JSON.stringify(value));
    }
  },
  deliverables: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const value = this.getDataValue('deliverables');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('deliverables', JSON.stringify(value));
    }
  },
  rating: {
    type: DataTypes.DECIMAL(3, 2),
    allowNull: true
  },
  feedback: {
    type: DataTypes.TEXT,
    allowNull: true
  }
});

// Associations
Project.belongsTo(Job, { foreignKey: 'job_id', as: 'job' });
Project.belongsTo(User, { foreignKey: 'client_id', as: 'client' });
Project.belongsTo(User, { foreignKey: 'engineer_id', as: 'engineer' });

User.hasMany(Project, { foreignKey: 'client_id', as: 'client_projects' });
User.hasMany(Project, { foreignKey: 'engineer_id', as: 'engineer_projects' });

module.exports = Project;