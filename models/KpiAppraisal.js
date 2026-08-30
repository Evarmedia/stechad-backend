const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class KpiAppraisal extends Model {}

KpiAppraisal.init(
  {
    kpi_appraisal_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    kpi_id: { type: DataTypes.UUID, allowNull: false },
    period_key: { type: DataTypes.STRING, allowNull: false },
    period_label: { type: DataTypes.STRING, allowNull: false },
    criteria_scores: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    overall_score: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
    notes: { type: DataTypes.TEXT, allowNull: true },
    recorded_by: { type: DataTypes.UUID, allowNull: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: "KpiAppraisal",
    tableName: "kpi_appraisals",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [{ unique: true, fields: ["kpi_id", "period_key"] }],
  },
);

module.exports = KpiAppraisal;
