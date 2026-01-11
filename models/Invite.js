const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User");
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
    role: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        isIn: [["admin", "project_manager", "engineer"]],
      },
    },
    temp_password: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
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
  }
);

Invite.beforeCreate(async (user) => {
  if (user.temp_password) {
    user.temp_password = await bcrypt.hash(user.temp_password, 12);
  }
});

Invite.beforeUpdate(async (user) => {
  if (user.changed('temp_password')) {
    user.temp_password = await bcrypt.hash(user.temp_password, 12);
  }
});

Invite.prototype.compareTempPassword = async function(tempUserPassword) {
  return await bcrypt.compare(tempUserPassword, this.temp_password)
};

Invite.prototype.toJSON = function() {
  const user = this.get();
  delete user.temp_password;
  return user;
};

module.exports = Invite;