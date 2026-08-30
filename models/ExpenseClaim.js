const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class ExpenseClaim extends Model {}

ExpenseClaim.init(
  {
    expense_claim_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    user_id: { type: DataTypes.UUID, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "USD" },
    description: { type: DataTypes.TEXT, allowNull: true },
    expense_date: { type: DataTypes.DATEONLY, allowNull: false },
    receipt_object_name: { type: DataTypes.TEXT, allowNull: true },
    receipt_original_name: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "pending",
      validate: { isIn: [["pending", "approved", "rejected", "receipt_verified", "paid"]] },
    },
    review_notes: { type: DataTypes.TEXT, allowNull: true },
    reviewed_by: { type: DataTypes.UUID, allowNull: true },
    reviewed_at: { type: DataTypes.DATE, allowNull: true },
    accounts_verified_by: { type: DataTypes.UUID, allowNull: true },
    accounts_verified_at: { type: DataTypes.DATE, allowNull: true },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: "ExpenseClaim",
    tableName: "expense_claims",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = ExpenseClaim;
