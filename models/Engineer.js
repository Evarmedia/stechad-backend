const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./User');

const Engineer = sequelize.define('Engineer', {
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
  skills: {
    type: DataTypes.TEXT,
    allowNull: true,
    get() {
      const value = this.getDataValue('skills');
      return value ? JSON.parse(value) : [];
    },
    set(value) {
      this.setDataValue('skills', JSON.stringify(value));
    }
  },
  experience_years: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  bio: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  resume_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  portfolio_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  github_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  linkedin_url: {
    type: DataTypes.STRING,
    allowNull: true
  },
  availability: {
    type: DataTypes.ENUM('available', 'busy', 'unavailable'),
    defaultValue: 'available'
  },
  hourly_rate: {
    type: DataTypes.DECIMAL(10, 2),
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
  is_vetted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  vetted_at: {
    type: DataTypes.DATE,
    allowNull: true
  },
  vetted_by: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  onboarding_completed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  rating: {
    type: DataTypes.DECIMAL(3, 2),
    defaultValue: 0.00
  },
  total_projects: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
});

// Associations
Engineer.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
User.hasOne(Engineer, { foreignKey: 'user_id', as: 'engineer' });

module.exports = Engineer;