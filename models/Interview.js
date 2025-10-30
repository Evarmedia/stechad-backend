const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const Engineer = require("./Engineer"); // Import Engineer model for relationship
const ProjectManager = require("./ProjectManager"); // Import ProjectManager model for relationship
const Job = require("./Job"); // Import Job model for relationship

class Interview extends Model {}

Interview.init(
  {
    interviews_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    candidate_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Engineer,
        key: 'engineer_id',
      },
    },
    candidate_name: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    candidate_email: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    interviewer_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: ProjectManager,
        key: 'project_managers_id',
      },
    },
    interviewer_email: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    job_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Job,
        key: 'jobs_id',
      },
    },
    job_title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    date_time: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    duration: {
      type: DataTypes.INTEGER,
      defaultValue: 60, // Duration in minutes
    },
    phone_number: {
      type: DataTypes.TEXT,
    },
    status: {
      type: DataTypes.ENUM('scheduled', 'completed', 'cancelled', 'rescheduled'),
      defaultValue: 'scheduled',
    },
    zoom_link: {
      type: DataTypes.TEXT,
    },
    calendar_event_id: {
      type: DataTypes.TEXT,
    },
    notes: {
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
    modelName: "Interview",
    tableName: "interviews",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

// Define relationships for Interview
Interview.belongsTo(Engineer, { foreignKey: 'candidate_id' });
Engineer.hasMany(Interview, { foreignKey: 'candidate_id' });

Interview.belongsTo(ProjectManager, { foreignKey: 'interviewer_id' });
ProjectManager.hasMany(Interview, { foreignKey: 'interviewer_id' });

Interview.belongsTo(Job, { foreignKey: 'job_id' });
Job.hasMany(Interview, { foreignKey: 'job_id' });

module.exports = Interview;
