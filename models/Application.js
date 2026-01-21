const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const Job = require("./Job");
const Engineer = require("./Engineer");
const User = require("./User");

class Application extends Model {}

Application.init(
  {
    applications_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    job_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Job,
        key: "jobs_id",
      },
    },
    engineer_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Engineer,
        key: "engineer_id",
      },
    },
    job_title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    engineer_name: {
      type: DataTypes.TEXT,
    },
    status: {
      type: DataTypes.ENUM(
        "pending",
        "reviewed",
        "shortlisted",
        "accepted",
        "rejected",
      ),
      defaultValue: "pending",
    },
    experience: {
      type: DataTypes.TEXT,
    },
    skills: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    reviewed_at: {
      type: DataTypes.DATE,
    },
    reviewed_by: {
      type: DataTypes.UUID,
      references: {
        model: User,
        key: "user_id",
      },
    },
    feedback: {
      type: DataTypes.TEXT,
    },
    applied_at: {
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
    modelName: "Application",
    tableName: "applications",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
);

module.exports = Application;
