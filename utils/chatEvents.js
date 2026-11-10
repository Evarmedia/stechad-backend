const { Chat } = require("../models");

// Personal rooms reach every participant's tabs, including those viewing another chat.
const publishChatEvent = async (io, chatId, event, payload) => {
  if (!io) return;
  const chat = await Chat.findByPk(chatId, { attributes: ["participants"] });
  if (chat)
    io.to(chat.participants.map((id) => `user_${id}`)).emit(event, {
      chat_id: chatId,
      ...payload,
    });
};

module.exports = { publishChatEvent };
