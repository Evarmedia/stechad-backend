const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const Chat = require("./Chat");
const User = require("./User");

class Message extends Model {}

Message.init(
  {
    messages_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    chat_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: Chat,
        key: 'chats_id',
      },
    },
    sender_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: User,
        key: 'user_id',
      },
    },
    message_type: {
      type: DataTypes.ENUM('text', 'image', 'file', 'system'),
      defaultValue: 'text',
    },
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachments: {
      type: DataTypes.JSONB,
      defaultValue: [],
    },
    reply_to: {
      type: DataTypes.UUID,
      references: {
        model: 'messages',
        key: 'messages_id',
      },
    },
    is_edited: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    edited_at: {
      type: DataTypes.DATE,
    },
    is_deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    deleted_at: {
      type: DataTypes.DATE,
    },
    read_by: {
      type: DataTypes.JSONB,
      defaultValue: {},
    },
    timestamp: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
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
    modelName: "Message",
    tableName: "messages",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = Message;