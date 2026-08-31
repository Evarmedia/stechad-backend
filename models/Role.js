const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class Role extends Model {}

Role.init(
  {
    role_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    role_key: {
      type: DataTypes.STRING(64),
      allowNull: false,
      validate: {
        notEmpty: true,
        len: [1, 64],
        is: /^[a-z][a-z0-9_]*$/,
      },
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      validate: { notEmpty: true, len: [1, 100] },
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    is_system: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
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
    modelName: "Role",
    tableName: "roles",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    indexes: [
      { name: "roles_role_key_unique", unique: true, fields: ["role_key"] },
      { name: "roles_name_unique", unique: true, fields: ["name"] },
    ],
    hooks: {
      beforeValidate: (role) => {
        if (typeof role.role_key === "string") {
          role.role_key = role.role_key.trim().toLowerCase().replace(/[\s-]+/g, "_");
        }
        if (typeof role.name === "string") role.name = role.name.trim();
        if (typeof role.description === "string") role.description = role.description.trim() || null;
      },
    },
  },
);

module.exports = Role;
