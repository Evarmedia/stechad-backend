const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const Chat = require("./Chat");
const User = require("./User");

class ChatUserState extends Model {}
ChatUserState.init(
  {
    chat_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      references: { model: Chat, key: "chats_id" },
      onDelete: "CASCADE",
    },
    user_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      references: { model: User, key: "user_id" },
      onDelete: "CASCADE",
    },
    cleared_through_sequence: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    unread_since_sequence: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    hidden_through_sequence: {
      type: DataTypes.BIGINT,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    modelName: "ChatUserState",
    tableName: "chat_user_states",
    timestamps: false,
  },
);
module.exports = ChatUserState;
