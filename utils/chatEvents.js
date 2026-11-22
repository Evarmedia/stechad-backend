const { Chat, Notification } = require("../services/hrModels");
const { findMessage } = require("./chatUtil");
const { emitToUser } = require('./events');

// Personal rooms reach every participant's tabs, including those viewing another chat.
const publishChatEvent = async (io, chatId, event, payload) => {
  if (!io) return;
  const chat = await Chat.findByPk(chatId, { attributes: ["participants"] });
  if (!chat) return;
  if (event === "new_message" && payload.message?._is_new === false) return;
  for (const userId of chat.participants) {
    const personalized = { chat_id: chatId, ...payload };
    if (payload.message) {
      personalized.message = await findMessage(
        payload.message.messages_id,
        userId,
      );
      if (!personalized.message) continue;
    }
    await emitToUser(io, userId, event, personalized);
    if (event === "new_message") {
      const notification = await Notification.findOne({
        where: {
          user_id: userId,
          chat_message_id: payload.message.messages_id,
        },
      });
      if (notification)
        await emitToUser(io, userId, "notification_created", {
          notification: notification.toJSON(),
        });
    }
  }
  if (event === "messages_read")
    await emitToUser(io, payload.user_id, "notifications_changed", {
      chat_id: chatId,
    });
};

module.exports = { publishChatEvent };
