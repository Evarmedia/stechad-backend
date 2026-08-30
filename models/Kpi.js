const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class Kpi extends Model {}

Kpi.init(
  {
    kpi_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    assigned_to_user_id: { type: DataTypes.UUID, allowNull: false },
    title: { type: DataTypes.STRING, allowNull: false },
    target: { type: DataTypes.TEXT, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    review_cycle: { type: DataTypes.STRING, allowNull: false, defaultValue: "Quarterly" },
    period_start: { type: DataTypes.DATEONLY, allowNull: true },
    period_end: { type: DataTypes.DATEONLY, allowNull: true },
    progress: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, validate: { min: 0, max: 100 } },
    appraisal_score: { type: DataTypes.DECIMAL(5, 2), allowNull: true },
    appraisal_notes: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "active",
      validate: { isIn: [["draft", "active", "completed", "archived"]] },
    },
    created_by: { type: DataTypes.UUID, allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: "Kpi",
    tableName: "kpis",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = Kpi;
