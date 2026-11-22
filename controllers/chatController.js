const chat = require("../utils/chatUtil");
const { publishChatEvent } = require("../utils/chatEvents");

const handle = (operation) => async (req, res) => {
  try {
    await operation(req, res);
  } catch (error) {
    if (!error.status) console.error("Chat request failed:", error);
    res.status(error.status || 500).json({
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

const management = require("../utils/chatManagement");
const policy = require("../utils/chatPolicy");
module.exports.clearHistory = handle(async (req, res) => {
  const result = await management.clearHistory(
    req.params.chat_id,
    req.user.user_id,
  );
  const io = req.app.get("io");
  await require('../utils/events').emitToUser(io, req.user.user_id, "history_cleared", result);
  await require('../utils/events').emitToUser(io, req.user.user_id, "notifications_changed", result);
  res.json({ success: true, data: result });
});
module.exports.deleteForUser = handle(async (req, res) => {
  const result = await management.deleteForUser(
    req.params.chat_id,
    req.user.user_id,
  );
  const io = req.app.get("io");
  await require('../utils/events').emitToUser(io, req.user.user_id, "chat_deleted", result);
  await require('../utils/events').emitToUser(io, req.user.user_id, "notifications_changed", result);
  if (result.purged)
    for (const userId of result.purged_for_user_ids)
      await require('../utils/events').emitToUser(io, userId, "chat_purged", {
        chat_id: result.chat_id,
      });
  res.json({ success: true, data: result });
});
module.exports.leaveGroup = handle(async (req, res) => {
  const result = await management.leaveGroup(
    req.params.chat_id,
    req.user.user_id,
  );
  const io = req.app.get("io");
  const { userRoom, chatRoom, emitToUser } = require('../utils/events');
  io?.in(userRoom(req.user.user_id)).socketsLeave(chatRoom(req.params.chat_id));
  await emitToUser(io, req.user.user_id, "group_left", { chat: result });
  await emitToUser(io, req.user.user_id, "notifications_changed", {
    chat_id: req.params.chat_id,
  });
  await notify(req, req.params.chat_id, "group_updated", {});
  res.json({ success: true, data: result });
});
const updateGroup = (operation) =>
  handle(async (req, res) => {
    const result = await operation(req);
    await notify(req, result.chats_id, "group_updated", {});
    res.json({ success: true, data: result });
  });
module.exports.updateSettings = updateGroup((req) =>
  management.updateSettings(req.params.chat_id, req.user.user_id, req.body),
);
module.exports.addMembers = updateGroup((req) =>
  management.addMembers(
    req.params.chat_id,
    req.user.user_id,
    req.body.participant_ids,
  ),
);
module.exports.removeMember = handle(async (req, res) => {
  const result = await management.removeMember(
    req.params.chat_id,
    req.user.user_id,
    req.params.user_id,
  );
  await require('../utils/events').emitToUser(req.app.get('io'), req.params.user_id, 'membership_revoked', { chat_id: req.params.chat_id });
  await require('../utils/events').emitToUser(req.app.get('io'), req.params.user_id, 'notifications_changed', { chat_id: req.params.chat_id });
  await notify(req, req.params.chat_id, "group_updated", {});
  res.json({ success: true, data: result });
});
module.exports.participantProfile = handle(async (req, res) =>
  res.json({
    success: true,
    data: await management.participantProfile(
      req.params.chat_id,
      req.user.user_id,
      req.params.user_id,
    ),
  }),
);
// Authenticate and authorize before buffering an upload or contacting object storage.
module.exports.groupImagePermission = async (req, res, next) => {
  try {
    await policy.requireManager(
      await chat.getAuthorizedChat(req.params.chat_id, req.user.user_id),
      req.user.user_id,
    );
    next();
  } catch (error) {
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Unable to authorize group image",
    });
  }
};
module.exports.uploadGroupImage = handle(async (req, res) => {
  const file = req.file;
  const bytes = file?.buffer;
  const signatures = {
    "image/jpeg": () =>
      bytes?.[0] === 0xff && bytes?.[1] === 0xd8 && bytes?.[2] === 0xff,
    "image/png": () =>
      bytes
        ?.subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/webp": () =>
      bytes?.toString("ascii", 0, 4) === "RIFF" &&
      bytes?.toString("ascii", 8, 12) === "WEBP",
  };
  if (!file || !signatures[file.mimetype]?.())
    throw policy.chatError("Choose a JPEG, PNG, or WebP image up to 2 MB");
  const storage = require("../middleware/upload");
  const previous = await chat.getAuthorizedChat(
    req.params.chat_id,
    req.user.user_id,
  );
  const uploaded = await storage.uploadToGCP(
    file,
    req.user.user_id,
    "chat-groups",
  );
  let result;
  try {
    result = await management.setGroupImage(
      req.params.chat_id,
      req.user.user_id,
      uploaded.objectName,
    );
  } catch (error) {
    await storage.deleteFromGCP(uploaded.objectName).catch(() => {});
    throw error;
  }
  if (previous.avatar_object_name)
    await storage.deleteFromGCP(previous.avatar_object_name).catch(() => {});
  await notify(req, req.params.chat_id, "group_updated", {});
  res.json({ success: true, data: result });
});
module.exports.removeGroupImage = handle(async (req, res) => {
  const previous = await chat.getAuthorizedChat(
    req.params.chat_id,
    req.user.user_id,
  );
  const result = await management.setGroupImage(
    req.params.chat_id,
    req.user.user_id,
    null,
  );
  if (previous.avatar_object_name)
    await require("../middleware/upload")
      .deleteFromGCP(previous.avatar_object_name)
      .catch(() => {});
  await notify(req, req.params.chat_id, "group_updated", {});
  res.json({ success: true, data: result });
});
