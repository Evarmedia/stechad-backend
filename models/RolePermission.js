const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class RolePermission extends Model {}

RolePermission.init(
  {
    role_permission_id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    permission_key: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    super_admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    admin: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    project_manager: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    staff: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    updated_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    modelName: "RolePermission",
    tableName: "role_permissions",
    timestamps: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
  }
);

module.exports = RolePermission;
