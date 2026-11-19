const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User"); // Import User model for relationship

class Notification extends Model {
  // Legacy workflows also write directly to this model. Keep deleted accounts
  // out of every delivery path, while preserving their existing notifications.
  static async currentRecipients(ids, options) {
    return User.findAll({
      where: { user_id: ids }, attributes: ["user_id"], transaction: options.transaction,
      ...(options.transaction ? { lock: { level: options.transaction.LOCK.SHARE, of: User } } : {}),
    });
  }
  static async create(values, options = {}) {
    if (!(await this.currentRecipients([values.user_id], options)).length) return null;
    return super.create(values, options);
  }
  static async bulkCreate(values, options = {}) {
    if (!values.length) return [];
    const recipients = new Set((await this.currentRecipients([...new Set(values.map((value) => value.user_id))], options)).map((user) => user.user_id));
    const deliverable = values.filter((value) => recipients.has(value.user_id));
    return deliverable.length ? super.bulkCreate(deliverable, options) : [];
  }
}

Notification.init(
  {
    notifications_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'user_id',
      },
    },
    broadcast_id: { type: DataTypes.UUID, allowNull: true },
    title: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    chat_message_id: { type: DataTypes.UUID, allowNull: true, references: { model: require("./Message"), key: "messages_id" }, onDelete: "CASCADE" },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('info', 'success', 'warning'),
      defaultValue: 'info',
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    read_at: {
      type: DataTypes.DATE,
    },
    action_url: {
      type: DataTypes.TEXT,
    },
    metadata: {
      type: DataTypes.JSONB,
      defaultValue: {},
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
    modelName: "Notification",
    tableName: "notifications",
    indexes: [{ unique: true, fields: ["user_id", "broadcast_id"], name: "notifications_broadcast_recipient_unique" }, { unique: true, fields: ["user_id", "chat_message_id"], name: "notifications_recipient_message_unique" }],
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = Notification;
