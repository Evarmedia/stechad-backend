const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User"); // Import User model for relationship

class Job extends Model {}

Job.init(
  {
    jobs_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    posted_by: {
      type: DataTypes.UUID,
      allowNull: true,
      references: {
        model: User,
        key: 'user_id',
      },
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    company: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    location: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    job_type: {
      type: DataTypes.ENUM('full-time', 'part-time', 'contract', 'internship'),
    },
    employment_type: {
      type: DataTypes.ENUM('full-time', 'contract', 'part-time'),
    },
    salary: {
      type: DataTypes.TEXT,
    },
    duration: {
      type: DataTypes.TEXT,
    },
    openings: {
      type: DataTypes.INTEGER,
      defaultValue: 1,
    },
    experience_level: {
      type: DataTypes.TEXT,
    },
    skills_required: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    responsibilities: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    requirements: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    remote: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'closed', 'draft'),
      defaultValue: 'active',
    },
    deadline: {
      type: DataTypes.DATE,
    },
    applications_count: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
    },
    posted_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "Job",
    tableName: "jobs",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = Job;
