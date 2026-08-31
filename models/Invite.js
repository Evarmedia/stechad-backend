const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User");
const Role = require("./Role");
const bcrypt = require('bcryptjs');

class Invite extends Model {}

Invite.init(
  {
    invite_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    email: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    first_name: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    last_name: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    department_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    job_title: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    employee_id: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    role_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: { model: Role, key: "role_id" },
    },
    // temp_password: {
    //   type: DataTypes.TEXT,
    //   allowNull: true,
    // },
    token: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM("pending", "accepted", "expired"),
      defaultValue: "pending",
    },
    sent_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    responded_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    invited_by_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: "user_id",
      },
    },
  },
  {
    sequelize,
    modelName: "Invite",
    tableName: "invites",
    timestamps: true,
    underscored: true,
    createdAt: "created_at",
    updatedAt: "updated_at",
    defaultScope: {
      include: [{ model: Role, as: "role", attributes: ["role_id", "role_key", "name", "description", "is_system"], required: true }],
    },
    indexes: [{ name: "invites_role_id", fields: ["role_id"] }],
  }
);

Invite.beforeCreate(async (invite) => {
  if (invite.temp_password && typeof invite.temp_password === "string") {
    invite.temp_password = await bcrypt.hash(invite.temp_password, 12);
  }
});

Invite.beforeUpdate(async (invite) => {
  if (
    invite.changed("temp_password") &&
    invite.temp_password &&
    typeof invite.temp_password === "string"
  ) {
    invite.temp_password = await bcrypt.hash(invite.temp_password, 12);
  }
});

Invite.prototype.compareTempPassword = async function(tempUserPassword) {
  return await bcrypt.compare(tempUserPassword, this.temp_password)
};

Invite.prototype.toJSON = function() {
  const user = this.get({ plain: true });
  if (user.role && typeof user.role === "object") {
    user.role_details = user.role;
    user.role = user.role.role_key;
  }
  delete user.temp_password;
  delete user.token;
  return user;
};

module.exports = Invite;
