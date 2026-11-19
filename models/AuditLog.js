const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
class AuditLog extends Model {}
AuditLog.init({
  audit_log_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  actor_user_id: { type: DataTypes.UUID, allowNull: true },
  actor_name: { type: DataTypes.TEXT, allowNull: true },
  action: { type: DataTypes.STRING, allowNull: false },
  target_type: { type: DataTypes.STRING, allowNull: false },
  target_id: { type: DataTypes.TEXT, allowNull: true },
  outcome: { type: DataTypes.STRING, allowNull: false, defaultValue: "success" },
  changes: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
  occurred_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
}, { sequelize, tableName: "audit_logs", modelName: "AuditLog", timestamps: false,
  indexes: [{ fields: ["occurred_at"] }, { fields: ["actor_user_id", "occurred_at"] }, { fields: ["target_type", "target_id"] }, { fields: ["action", "occurred_at"] }] });
for (const operation of ["beforeUpdate", "beforeDestroy", "beforeBulkUpdate", "beforeBulkDestroy", "beforeUpsert"]) {
  AuditLog.addHook(operation, () => { throw new Error("Audit logs are append-only"); });
}
module.exports = AuditLog;
