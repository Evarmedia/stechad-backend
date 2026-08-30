const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class Attendance extends Model {}

Attendance.init(
  {
    attendance_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    user_id: { type: DataTypes.UUID, allowNull: false },
    work_date: { type: DataTypes.DATEONLY, allowNull: false },
    clock_in: { type: DataTypes.DATE, allowNull: false },
    clock_out: { type: DataTypes.DATE, allowNull: true },
    work_log: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "present",
      validate: { isIn: [["present", "late", "completed"]] },
    },
    latitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    longitude: { type: DataTypes.DECIMAL(10, 7), allowNull: true },
    location_accuracy: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: "Attendance",
    tableName: "attendance_entries",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ unique: true, fields: ["user_id", "work_date"] }],
  }
);

module.exports = Attendance;
