const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const User = require("./User"); // Import User model for relationship

class Chat extends Model {}

Chat.init(
  {
    chats_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    participants: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: false, // Array of user IDs
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
