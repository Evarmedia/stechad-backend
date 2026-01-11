const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User");

class Engineer extends Model {}

Engineer.init(
  {
    engineer_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    date_of_birth: {
      type: DataTypes.DATEONLY,
    },
    open_to_nearby_cities: {
      type: DataTypes.BOOLEAN,
    },
    languages: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    language_proficiency: {
      type: DataTypes.ENUM("basic", "conversational", "fluent", "native"),
    },
    has_drivers_license: {
      type: DataTypes.BOOLEAN,
    },
    has_car: {
      type: DataTypes.BOOLEAN,
    },
    is_native: {
      type: DataTypes.BOOLEAN,
    },
    work_authorized: {
      type: DataTypes.BOOLEAN,
    },
    specialization: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    skill_level: {
      type: DataTypes.ENUM("beginner", "intermediate", "advanced", "expert"), //Change these
    },
    years_of_experience: {
      type: DataTypes.FLOAT,
    },
    certifications: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    project_types: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
    },
    open_to_training: {
      type: DataTypes.BOOLEAN,
    },
    is_freelancer: {
      type: DataTypes.BOOLEAN,
    },
    follows_linkedin: {
      type: DataTypes.BOOLEAN,
    },
    referee_info: {
      type: DataTypes.TEXT,
    },
    newsletter: {
      type: DataTypes.BOOLEAN,
    },
    special_preferences: {
      type: DataTypes.TEXT,
    },
    cv_object_name: {
      type: DataTypes.TEXT,
    },
    is_vetted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    vetted_by: {
      type: DataTypes.UUID,
      references: {
        model: User,
        key: "user_id",
      },
    },
    vetted_at: {
      type: DataTypes.DATE,
    },
    availability: {
      type: DataTypes.ENUM("available", "busy", "unavailable"),
      defaultValue: "available",
    },
    status: {
      type: DataTypes.ENUM("active", "inactive", "suspended"),
      defaultValue: "active",
    },
    is_onboarded: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    onboarded_at: {
      type: DataTypes.DATE,
    },
  },
  {
    sequelize,
    modelName: "Engineer",
    tableName: "engineers",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = Engineer;
