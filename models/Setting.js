const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class Setting extends Model {}

Setting.init(
  {
    settings_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    key: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true, // Ensures that each setting key is unique
    },
    value: {
      type: DataTypes.TEXT,
    },
    type: {
      type: DataTypes.ENUM('string', 'number', 'boolean', 'json'),
    },
    description: {
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
    modelName: "Setting",
    tableName: "settings",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = Setting;
