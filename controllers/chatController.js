const chat = require("../utils/chatUtil");
const { publishChatEvent } = require("../utils/chatEvents");

const handle = (operation) => async (req, res) => {
  try {
    await operation(req, res);
  } catch (error) {
    if (!error.status) console.error("Chat request failed:", error);
    res
      .status(error.status || 500)
      .json({
        success: false,
        message: error.status
          ? error.message
          : "Unable to complete the chat request. Please try again.",
      });
  }
};
// A notification failure must not turn an already-committed write into a failed send.
const notify = (req, chatId, event, payload) =>
  publishChatEvent(req.app.get("io"), chatId, event, payload).catch((error) =>
    console.error("Chat notification failed:", error),
  );
const getChats = handle(async (req, res) =>
  res.json({
    success: true,
    data: await chat.getUserChats(req.user.user_id, req.query),
  }),
);
const getAvailableUsers = handle(async (req, res) =>
  res.json({
    success: true,
    data: await chat.getAvailableUsers(req.user.user_id, req.query),
  }),
);
const getChatDetails = handle(async (req, res) =>
  res.json({
    success: true,
    data: await chat.getChatDetails(req.params.chat_id, req.user.user_id),
  }),
);
const createNewChat = handle(async (req, res) => {
  const { participant_ids, chat_type = "direct", chat_name = null } = req.body;
  const result = await chat.createChat(
    participant_ids,
    req.user.user_id,
    chat_type,
    chat_name,
  );
  await notify(req, result.chats_id, "chat_created", {});
  res.status(201).json({ success: true, data: result });
});
const getMessages = handle(async (req, res) =>
  res.json({
    success: true,
    data: await chat.getChatMessages(
      req.params.chat_id,
      req.user.user_id,
      req.query,
    ),
  }),
);
const sendChatMessage = handle(async (req, res) => {
  const {
    content,
    message_type = "text",
    attachments = [],
    reply_to = null,
    client_message_id = null,
  } = req.body;
  const message = await chat.sendMessage(
    req.params.chat_id,
    req.user.user_id,
    content,
    message_type,
    attachments,
    reply_to,
    client_message_id,
  );
  await notify(req, req.params.chat_id, "new_message", { message });
  res.status(201).json({ success: true, data: message });
});
const markAsRead = handle(async (req, res) => {
  const receipt = await chat.markMessagesAsRead(
    req.params.chat_id,
    req.user.user_id,
    req.body.message_ids,
  );
  await notify(req, req.params.chat_id, "messages_read", receipt);
  res.json({ success: true, data: receipt });
});
const editChatMessage = handle(async (req, res) => {
  const message = await chat.editMessage(
    req.params.message_id,
    req.user.user_id,
    req.body.content,
  );
  await notify(req, message.chat_id, "message_updated", { message });
  res.json({ success: true, data: message });
});
const deleteChatMessage = handle(async (req, res) => {
  const message = await chat.deleteMessage(
    req.params.message_id,
    req.user.user_id,
  );
  await notify(req, message.chat_id, "message_deleted", { message });
  res.json({ success: true, data: message });
});
const searchChatMessages = handle(async (req, res) =>
  res.json({
    success: true,
    data: await chat.searchMessages(
      req.user.user_id,
      req.query.query,
      req.query,
    ),
  }),
);

module.exports = {
  getChats,
  getAvailableUsers,
  getChatDetails,
  createNewChat,
  getMessages,
  sendChatMessage,
  markAsRead,
  editChatMessage,
  deleteChatMessage,
  searchChatMessages,
};
