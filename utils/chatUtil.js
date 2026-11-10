const { Chat, Message, User } = require("../models");
const { Op } = require("sequelize");
const sequelize = require("../config/database");
const { ROLE_INCLUDE } = require("./roleUtils");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ATTRIBUTES = [
  "user_id",
  "first_name",
  "last_name",
  "avatar_object_name",
  "role_id",
];
const chatError = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const validateId = (id, label = "ID") => {
  if (typeof id !== "string" || !UUID_PATTERN.test(id))
    throw chatError(`Invalid ${label}`);
};
const pagination = (options = {}, defaultLimit = 50) => {
  const page = Number(options.page ?? 1);
  const limit = Number(options.limit ?? defaultLimit);
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw chatError(
      "Page must be positive and limit must be between 1 and 100",
    );
  }
  return { page, limit, offset: (page - 1) * limit };
};
const pageInfo = (count, page, limit) => ({
  currentPage: page,
  totalPages: Math.ceil(count / limit),
  totalItems: count,
  itemsPerPage: limit,
});

const formatUser = async (user) => {
  const data = user.toJSON();
  if (data.avatar_object_name) {
    try {
      const { getV4ReadSignedUrl } = require("../config/gcpStorage");
      data.avatar_url = await getV4ReadSignedUrl(data.avatar_object_name);
    } catch {
      data.avatar_url = null;
    }
  }
  return data;
};
const messageInclude = [
  { model: User, as: "sender", attributes: USER_ATTRIBUTES },
  {
    model: Message,
    as: "replyToMessage",
    include: [{ model: User, as: "sender", attributes: USER_ATTRIBUTES }],
  },
];
const formatMessage = async (message) => {
  const data = message.toJSON();
  if (message.sender) data.sender = await formatUser(message.sender);
  if (message.replyToMessage?.sender)
    data.replyToMessage.sender = await formatUser(
      message.replyToMessage.sender,
    );
  // A deleted message's content must not leak through a quoted reply.
  if (data.replyToMessage?.is_deleted) {
    data.replyToMessage.content = "This message was deleted";
    data.replyToMessage.attachments = [];
  }
  return data;
};
const findMessage = async (id) =>
  formatMessage(await Message.findByPk(id, { include: messageInclude }));

const getAuthorizedChat = async (chatId, userId, options = {}) => {
  validateId(chatId, "chat ID");
  const chat = await Chat.findOne({
    where: {
      chats_id: chatId,
      is_active: true,
      participants: { [Op.contains]: [userId] },
    },
    ...options,
  });
  if (!chat) throw chatError("Chat not found or access denied", 404);
  return chat;
};

const getChatDetails = async (chatId, userId) => {
  const chat = await getAuthorizedChat(chatId, userId);
  const participants = await User.findAll({
    where: { user_id: { [Op.in]: chat.participants } },
    attributes: USER_ATTRIBUTES,
    include: [ROLE_INCLUDE],
  });
  return {
    ...chat.toJSON(),
    participant_details: await Promise.all(participants.map(formatUser)),
    unread_count: chat.unread_counts?.[userId] || 0,
  };
};

const getAvailableUsers = async (userId, options = {}) => {
  const { page, limit, offset } = pagination(options, 20);
  const search = String(options.search || "")
    .trim()
    .slice(0, 100);
  const where = { is_active: true, user_id: { [Op.ne]: userId } };
  if (search)
    where[Op.and] = search
      .split(/\s+/)
      .map((term) => ({
        [Op.or]: ["first_name", "last_name"].map((field) => ({
          [field]: { [Op.iLike]: `%${term}%` },
        })),
      }));
  const users = await User.findAndCountAll({
    where,
    attributes: USER_ATTRIBUTES,
    include: [ROLE_INCLUDE],
    order: [
      ["first_name", "ASC"],
      ["user_id", "ASC"],
    ],
    limit,
    offset,
  });
  return {
    users: await Promise.all(users.rows.map(formatUser)),
    pagination: pageInfo(users.count, page, limit),
  };
};

const createChat = async (
  participantIds,
  createdBy,
  chatType = "direct",
  chatName = null,
) => {
  if (!Array.isArray(participantIds))
    throw chatError("Participant IDs must be an array");
  const participants = [...new Set([createdBy, ...participantIds])].sort();
  participants.forEach((id) => validateId(id, "participant ID"));
  if (participants.length < 2 || participants.length > 100)
    throw chatError("A chat requires between 2 and 100 participants");
  if (!["direct", "group", "support"].includes(chatType))
    throw chatError("Invalid chat type");
  if (chatType === "direct" && participants.length !== 2)
    throw chatError("Direct chats require exactly 2 participants");
  if (
    chatName !== null &&
    (typeof chatName !== "string" || chatName.trim().length > 100)
  )
    throw chatError("Chat name must be at most 100 characters");
  if (chatType !== "direct" && !chatName?.trim())
    throw chatError("A name is required for group and support chats");

  const chat = await sequelize.transaction(async (transaction) => {
    // Lock in ID order so concurrent attempts to start the same direct chat reuse it.
    const users = await User.unscoped().findAll({
      where: { user_id: { [Op.in]: participants }, is_active: true },
      attributes: ["user_id"],
      order: [["user_id", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (users.length !== participants.length)
      throw chatError("One or more participants are unavailable");
    if (chatType === "direct") {
      const existing = await Chat.findOne({
        where: {
          chat_type: "direct",
          participants: {
            [Op.contains]: participants,
            [Op.contained]: participants,
          },
          is_active: true,
        },
        transaction,
      });
      if (existing) return existing;
    }
    return Chat.create(
      {
        chat_type: chatType,
        chat_name: chatName?.trim() || null,
        participants,
        unread_counts: Object.fromEntries(participants.map((id) => [id, 0])),
        created_by: createdBy,
      },
      { transaction },
    );
  });
  return getChatDetails(chat.chats_id, createdBy);
};

const getUserChats = async (userId, options = {}) => {
  const { page, limit, offset } = pagination(options, 50);
  const where = { participants: { [Op.contains]: [userId] }, is_active: true };
  if (options.chat_type) {
    if (!["direct", "group", "support"].includes(options.chat_type))
      throw chatError("Invalid chat type");
    where.chat_type = options.chat_type;
  }
  const chats = await Chat.findAndCountAll({
    where,
    limit,
    offset,
    order: [
      ["updated_at", "DESC"],
      ["chats_id", "ASC"],
    ],
  });
  const ids = [...new Set(chats.rows.flatMap((chat) => chat.participants))];
  // One participant query for the entire inbox, rather than one query per chat.
  const users = ids.length
    ? await User.findAll({
        where: { user_id: { [Op.in]: ids } },
        attributes: USER_ATTRIBUTES,
        include: [ROLE_INCLUDE],
      })
    : [];
  const details = new Map(
    (await Promise.all(users.map(formatUser))).map((user) => [
      user.user_id,
      user,
    ]),
  );
  return {
    chats: chats.rows.map((chat) => ({
      ...chat.toJSON(),
      participant_details: chat.participants
        .map((id) => details.get(id))
        .filter(Boolean),
      unread_count: chat.unread_counts?.[userId] || 0,
    })),
    pagination: pageInfo(chats.count, page, limit),
  };
};

const validateContent = (content) => {
  if (typeof content !== "string" || !content.trim())
    throw chatError("Message cannot be empty");
  if (content.length > 10000)
    throw chatError("Message must be at most 10,000 characters");
  return content.trim();
};
const sendMessage = async (
  chatId,
  senderId,
  content,
  messageType = "text",
  attachments = [],
  replyTo = null,
  clientMessageId = null,
) => {
  const text = validateContent(content);
  if (!["text", "image", "file"].includes(messageType))
    throw chatError("Invalid message type");
  if (!Array.isArray(attachments) || attachments.length > 10)
    throw chatError("Attachments must be an array of at most 10 items");
  if (replyTo) validateId(replyTo, "reply message ID");
  if (clientMessageId) validateId(clientMessageId, "client message ID");
  const message = await sequelize.transaction(async (transaction) => {
    const chat = await getAuthorizedChat(chatId, senderId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (clientMessageId) {
      const existing = await Message.findByPk(clientMessageId, { transaction });
      if (existing) {
        if (existing.chat_id !== chatId || existing.sender_id !== senderId)
          throw chatError("Message ID is already in use");
        return existing;
      }
    }
    if (
      replyTo &&
      !(await Message.findOne({
        where: { messages_id: replyTo, chat_id: chatId, is_deleted: false },
        transaction,
      }))
    )
      throw chatError("Reply message is not available in this conversation");
    const created = await Message.create(
      {
        ...(clientMessageId ? { messages_id: clientMessageId } : {}),
        chat_id: chatId,
        sender_id: senderId,
        content: text,
        message_type: messageType,
        attachments,
        reply_to: replyTo,
        read_by: { [senderId]: new Date().toISOString() },
      },
      { transaction },
    );
    const counts = { ...chat.unread_counts };
    for (const id of chat.participants)
      if (id !== senderId) counts[id] = (counts[id] || 0) + 1;
    await chat.update(
      {
        last_message_id: created.messages_id,
        last_message_content: text,
        last_message_sender_id: senderId,
        last_message_timestamp: created.timestamp,
        unread_counts: counts,
      },
      { transaction },
    );
    return created;
  });
  return findMessage(message.messages_id);
};

const getChatMessages = async (chatId, userId, options = {}) => {
  await getAuthorizedChat(chatId, userId);
  const { page, limit, offset } = pagination(options);
  const where = { chat_id: chatId, is_deleted: false };
  if (options.before_timestamp) {
    const before = new Date(options.before_timestamp);
    if (!Number.isFinite(before.getTime()))
      throw chatError("Invalid before_timestamp");
    if (options.before_id) {
      validateId(options.before_id, "cursor message ID");
      where[Op.or] = [
        { timestamp: { [Op.lt]: before } },
        { timestamp: before, messages_id: { [Op.lt]: options.before_id } },
      ];
    } else where.timestamp = { [Op.lt]: before };
  }
  const messages = await Message.findAndCountAll({
    where,
    include: messageInclude,
    limit,
    offset,
    order: [
      ["timestamp", "DESC"],
      ["messages_id", "DESC"],
    ],
  });
  return {
    messages: await Promise.all(messages.rows.reverse().map(formatMessage)),
    pagination: pageInfo(messages.count, page, limit),
  };
};

const markMessagesAsRead = async (chatId, userId, messageIds = []) => {
  if (!Array.isArray(messageIds) || messageIds.length > 500)
    throw chatError("Message IDs must be an array of at most 500 items");
  messageIds.forEach((id) => validateId(id, "message ID"));
  return sequelize.transaction(async (transaction) => {
    const chat = await getAuthorizedChat(chatId, userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const where = {
      chat_id: chatId,
      is_deleted: false,
      sender_id: { [Op.ne]: userId },
    };
    if (messageIds.length) where.messages_id = { [Op.in]: messageIds };
    await Message.update(
      {
        read_by: sequelize.fn(
          "jsonb_set",
          sequelize.fn(
            "COALESCE",
            sequelize.col("read_by"),
            sequelize.cast("{}", "jsonb"),
          ),
          sequelize.cast(`{${userId}}`, "text[]"),
          JSON.stringify(new Date().toISOString()),
          true,
        ),
      },
      { where, transaction },
    );
    // Recalculate for partial reads as well; marking all read also persists receipts.
    const unread = await Message.count({
      where: {
        chat_id: chatId,
        is_deleted: false,
        sender_id: { [Op.ne]: userId },
        [Op.or]: [
          { read_by: null },
          sequelize.where(sequelize.json(`read_by.${userId}`), Op.is, null),
        ],
      },
      transaction,
    });
    await chat.update(
      { unread_counts: { ...chat.unread_counts, [userId]: unread } },
      { transaction, silent: true },
    );
    return {
      chat_id: chatId,
      user_id: userId,
      message_ids: messageIds,
      unread_count: unread,
      read_at: new Date().toISOString(),
    };
  });
};

const mutateMessage = async (messageId, userId, content, deleting) => {
  validateId(messageId, "message ID");
  const original = await Message.findByPk(messageId, {
    attributes: ["chat_id"],
  });
  if (!original) throw chatError("Message not found", 404);
  await sequelize.transaction(async (transaction) => {
    const chat = await getAuthorizedChat(original.chat_id, userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const message = await Message.findByPk(messageId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (message.sender_id !== userId)
      throw chatError("Only the sender can change this message", 403);
    if (message.is_deleted) throw chatError("Message not found", 404);
    await message.update(
      deleting
        ? {
            content: "This message was deleted",
            attachments: [],
            is_deleted: true,
            deleted_at: new Date(),
          }
        : { content, is_edited: true, edited_at: new Date() },
      { transaction },
    );
    if (deleting) {
      const counts = { ...chat.unread_counts };
      for (const id of chat.participants)
        if (id !== userId && !message.read_by?.[id])
          counts[id] = Math.max(0, (counts[id] || 0) - 1);
      await chat.update(
        {
          unread_counts: counts,
          ...(chat.last_message_id === messageId
            ? { last_message_content: "This message was deleted" }
            : {}),
        },
        { transaction, silent: true },
      );
    } else if (chat.last_message_id === messageId)
      await chat.update(
        { last_message_content: content },
        { transaction, silent: true },
      );
  });
  return findMessage(messageId);
};
const editMessage = (messageId, userId, content) =>
  mutateMessage(messageId, userId, validateContent(content), false);
const deleteMessage = (messageId, userId) =>
  mutateMessage(messageId, userId, null, true);

const searchMessages = async (userId, query, options = {}) => {
  if (
    typeof query !== "string" ||
    query.trim().length < 2 ||
    query.length > 200
  )
    throw chatError("Search query must be between 2 and 200 characters");
  const { page, limit, offset } = pagination(options, 20);
  const userChats = await Chat.findAll({
    where: { participants: { [Op.contains]: [userId] }, is_active: true },
    attributes: ["chats_id"],
  });
  const ids = userChats.map((chat) => chat.chats_id);
  if (options.chat_id) {
    validateId(options.chat_id, "chat ID");
    if (!ids.includes(options.chat_id))
      throw chatError("Chat not found or access denied", 404);
  }
  const messages = await Message.findAndCountAll({
    where: {
      content: { [Op.iLike]: `%${query.trim()}%` },
      is_deleted: false,
      chat_id: options.chat_id || { [Op.in]: ids },
    },
    include: messageInclude,
    limit,
    offset,
    order: [
      ["timestamp", "DESC"],
      ["messages_id", "DESC"],
    ],
  });
  return {
    messages: await Promise.all(messages.rows.map(formatMessage)),
    pagination: pageInfo(messages.count, page, limit),
  };
};

module.exports = {
  createChat,
  getUserChats,
  getAvailableUsers,
  getChatDetails,
  getAuthorizedChat,
  sendMessage,
  getChatMessages,
  markMessagesAsRead,
  editMessage,
  deleteMessage,
  searchMessages,
};
