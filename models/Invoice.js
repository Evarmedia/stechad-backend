const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class Invoice extends Model {}

Invoice.init(
  {
    invoice_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    invoice_number: { type: DataTypes.STRING, allowNull: false, unique: true },
    submitted_by: { type: DataTypes.UUID, allowNull: false },
    project_id: { type: DataTypes.UUID, allowNull: true },
    invoice_type: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: { isIn: [["engineer", "staff", "project"]] },
    },
    period: { type: DataTypes.STRING, allowNull: false },
    client_name: { type: DataTypes.STRING, allowNull: true },
    amount: { type: DataTypes.DECIMAL(14, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
    notes: { type: DataTypes.TEXT, allowNull: true },
    line_items: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "pending",
      validate: { isIn: [["draft", "pending", "approved", "disputed", "accounts_approved", "paid"]] },
    },
    review_notes: { type: DataTypes.TEXT, allowNull: true },
    reviewed_by: { type: DataTypes.UUID, allowNull: true },
    reviewed_at: { type: DataTypes.DATE, allowNull: true },
    zoho_invoice_id: { type: DataTypes.STRING, allowNull: true },
    zoho_synced_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: "Invoice",
    tableName: "invoices",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = Invoice;
