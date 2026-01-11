const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const ProjectManager = require("./ProjectManager"); // Import ProjectManager model for relationship
const Job = require("./Job"); // Import Job model for relationship
const User = require("./User"); // Import User model for relationship

class Project extends Model {}

Project.init(
  {
    projects_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    // project_managers_user_id: {
    //   type: DataTypes.UUID,
    //   allowNull: true,
    //   references: {
    //     model: ProjectManager,
    //     key: 'user_id',
    //   },
    // },
    project_managers_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
    },
    // job_id: {
    //   type: DataTypes.UUID,
    //   references: {
    //     model: Job,
    //     key: 'jobs_id',
    //   },
    // },
    // engineer_user_id: {
    //   type: DataTypes.UUID,
    //   references: {
    //     model: User,
    //     key: 'user_id',
    //   },
    // },
    status: {
      type: DataTypes.ENUM(
        "planning",
        "in_progress",
        "completed",
        "on_hold",
        "cancelled"
      ),
      defaultValue: "planning",
    },
    priority: {
      type: DataTypes.ENUM("high", "medium", "low", "critical"),
      defaultValue: "medium",
    },
    progress: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      validate: {
        min: 0,
        max: 100,
      },
    },
    team: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    tasks: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    start_date: {
      type: DataTypes.DATE,
    },
    deadline: {
      type: DataTypes.DATE,
    },
    feedback: {
      type: DataTypes.TEXT,
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
    modelName: "Project",
    tableName: "projects",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = Project;
