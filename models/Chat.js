const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");

class Chat extends Model {}

Chat.init(
  {
    chats_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    chat_type: {
      type: DataTypes.ENUM('direct', 'group', 'support'),
      defaultValue: 'direct',
    },
    chat_name: {
      type: DataTypes.STRING,
    },
    participants: {
      type: DataTypes.ARRAY(DataTypes.UUID),
      allowNull: false,
      defaultValue: [],
    },
    last_message_id: {
      type: DataTypes.UUID,
    },
    last_message_content: {
      type: DataTypes.TEXT,
    },
    last_message_sender_id: {
      type: DataTypes.UUID,
    },
    last_message_timestamp: {
      type: DataTypes.DATE,
    },
    unread_counts: {
      type: DataTypes.JSONB,
      defaultValue: {},
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    created_by: {
      type: DataTypes.UUID,
      allowNull: false,
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
    modelName: "Chat",
    tableName: "chats",
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  }
);

module.exports = Chat;