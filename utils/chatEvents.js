const { Chat, Notification } = require("../models");
const { findMessage } = require("./chatUtil");

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
    io.to(`user_${userId}`).emit(event, personalized);
    if (event === "new_message") {
      const notification = await Notification.findOne({
        where: {
          user_id: userId,
          chat_message_id: payload.message.messages_id,
        },
      });
      if (notification)
        io.to(`user_${userId}`).emit("notification_created", {
          notification: notification.toJSON(),
        });
    }
  }
  if (event === "messages_read")
    io.to(`user_${payload.user_id}`).emit("notifications_changed", {
      chat_id: chatId,
    });
};

module.exports = { publishChatEvent };
