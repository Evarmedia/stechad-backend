const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const Chat = require("./Chat"); // Import Chat model for relationship
const User = require("./User"); // Import User model for relationship

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
    content: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    attachments: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      defaultValue: [],
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
