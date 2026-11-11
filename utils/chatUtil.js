const {
  Chat,
  Message,
  User,
  ChatUserState,
  Notification,
} = require("../models");
const { Op, QueryTypes } = require("sequelize");
const sequelize = require("../config/database");
const { ROLE_INCLUDE } = require("./roleUtils");
const policy = require("./chatPolicy");

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
const formatMessage = async (message, userId, suppliedState) => {
  if (!message) return null;
  const state =
    suppliedState || (await policy.userState(message.chat_id, userId));
  if (!policy.visible(message.message_sequence, state)) return null;
  const data = message.toJSON();
  if (message.sender) data.sender = await formatUser(message.sender);
  if (message.replyToMessage?.sender)
    data.replyToMessage.sender = await formatUser(
      message.replyToMessage.sender,
    );
  // A deleted message's content must not leak through a quoted reply.
  if (
    data.replyToMessage &&
    !policy.visible(data.replyToMessage.message_sequence, state)
  ) {
    data.replyToMessage = null;
    data.reply_unavailable = true;
  }
  if (data.replyToMessage?.is_deleted) {
    data.replyToMessage.content = "This message was deleted";
    data.replyToMessage.attachments = [];
  }
  return data;
};
const findMessage = async (id, userId) =>
  formatMessage(
    await Message.findByPk(id, { include: messageInclude }),
    userId,
  );

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

const getAccessibleChat = async (chatId, userId, options = {}) => {
  validateId(chatId, "chat ID");
  const active = await Chat.findOne({
    where: {
      chats_id: chatId,
      is_active: true,
      participants: { [Op.contains]: [userId] },
    },
    ...options,
  });
  if (active) return active;
  const state = await ChatUserState.findOne({
    where: {
      chat_id: chatId,
      user_id: userId,
      left_through_sequence: { [Op.ne]: null },
    },
    transaction: options.transaction,
  });
  if (!state) throw chatError("Chat not found or access denied", 404);
  const chat = await Chat.findOne({
    where: { chats_id: chatId, is_active: true },
    ...options,
  });
  if (!chat) throw chatError("Chat not found or access denied", 404);
  return chat;
};

const formatChat = async (chat, userId, details, snapshot) => {
  const state = snapshot
    ? snapshot.states.get(chat.chats_id) || {
        cleared_through_sequence: "0",
        left_through_sequence: null,
      }
    : await policy.userState(chat.chats_id, userId);
  const data = chat.toJSON();
  delete data.unread_counts;
  const hasLeft = state.left_through_sequence !== null;
  const last = hasLeft
    ? await Message.findOne({
        where: {
          chat_id: chat.chats_id,
          is_deleted: false,
          ...policy.sequenceWhere(state),
        },
        attributes: [
          "messages_id",
          "message_sequence",
          "content",
          "sender_id",
          "timestamp",
        ],
        order: [["message_sequence", "DESC"]],
      })
    : snapshot
      ? snapshot.lastMessages.get(chat.last_message_id)
      : chat.last_message_id &&
        (await Message.findByPk(chat.last_message_id, {
          attributes: ["message_sequence"],
        }));
  data.last_message_sequence = last ? String(last.message_sequence) : null;
  if (
    !last ||
    !policy.after(last.message_sequence, state.cleared_through_sequence)
  ) {
    for (const key of [
      "last_message_id",
      "last_message_content",
      "last_message_sender_id",
      "last_message_timestamp",
    ])
      data[key] = null;
  } else if (hasLeft) {
    data.last_message_id = last.messages_id;
    data.last_message_content = last.content;
    data.last_message_sender_id = last.sender_id;
    data.last_message_timestamp = last.timestamp;
  }
  if (hasLeft) data.updated_at = last?.timestamp || data.created_at;
  let avatar_url = null;
  if (chat.avatar_object_name) {
    try {
      avatar_url = await require("../config/gcpStorage").getV4ReadSignedUrl(
        chat.avatar_object_name,
      );
    } catch {}
  }
  return {
    ...data,
    avatar_url,
    participant_details: details,
    unread_count: hasLeft ? 0 : chat.unread_counts?.[userId] || 0,
    cleared_through_sequence: String(state.cleared_through_sequence),
    left_through_sequence: hasLeft ? String(state.left_through_sequence) : null,
    has_left: hasLeft,
    can_leave:
      !hasLeft &&
      chat.chat_type !== "direct" &&
      chat.created_by !== userId &&
      chat.participants.includes(userId),
    can_manage:
      !hasLeft &&
      policy.canManage(
        chat,
        userId,
        snapshot ? snapshot.role : await policy.actorRole(userId),
      ),
    can_post:
      !hasLeft &&
      (chat.chat_type === "direct" ||
        chat.posting_policy !== "creator_only" ||
        chat.created_by === userId),
  };
};
const getChatDetails = async (chatId, userId) => {
  const chat = await getAccessibleChat(chatId, userId);
  const participants = await User.findAll({
    where: { user_id: { [Op.in]: chat.participants } },
    attributes: USER_ATTRIBUTES,
    include: [ROLE_INCLUDE],
  });
  return formatChat(
    chat,
    userId,
    await Promise.all(participants.map(formatUser)),
  );
};

const getAvailableUsers = async (userId, options = {}) => {
  const { page, limit, offset } = pagination(options, 20);
  const search = String(options.search || "")
    .trim()
    .slice(0, 100);
  const context = options.context || "direct";
  let group;
  if (options.chat_id) {
    group = await getAuthorizedChat(options.chat_id, userId);
    await policy.requireManager(group, userId);
    if (context !== "group") throw chatError("Group context is required");
  }
  const filter = await policy.contactFilter(userId, context);
  const where = {
    [Op.and]: [
      filter,
      {
        is_active: true,
        user_id: { [Op.notIn]: group ? group.participants : [userId] },
      },
    ],
  };
  if (search)
    where[Op.and].push(
      ...search.split(/\s+/).map((term) => ({
        [Op.or]: ["first_name", "last_name"].map((field) => ({
          [field]: { [Op.iLike]: `%${term}%` },
        })),
      })),
    );
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
      if (existing) {
        // Starting a previously deleted direct chat is an explicit restore for
        // the caller. Their personal clear boundary remains in place.
        await ChatUserState.update(
          { hidden_through_sequence: null, left_through_sequence: null },
          {
            where: { chat_id: existing.chats_id, user_id: createdBy },
            transaction,
          },
        );
        return existing;
      }
    }
    await policy.requireContacts(
      participants.filter((id) => id !== createdBy),
      createdBy,
      chatType === "direct" ? "direct" : "group",
      transaction,
    );
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
  const archived = await ChatUserState.findAll({
    where: { user_id: userId, left_through_sequence: { [Op.ne]: null } },
    attributes: ["chat_id"],
  });
  const archivedIds = archived.map((state) => state.chat_id);
  const where = {
    [Op.or]: [
      { participants: { [Op.contains]: [userId] } },
      ...(archivedIds.length ? [{ chats_id: { [Op.in]: archivedIds } }] : []),
    ],
    is_active: true,
  };
  if (options.chat_type) {
    if (!["direct", "group", "support"].includes(options.chat_type))
      throw chatError("Invalid chat type");
    where.chat_type = options.chat_type;
  }
  const hidden = await sequelize.query(
    `SELECT state.chat_id
    FROM ${policy.quoteTable("chat_user_states")} state
    LEFT JOIN ${policy.quoteTable("chats")} chat ON chat.chats_id = state.chat_id
    LEFT JOIN ${policy.quoteTable("messages")} message ON message.messages_id = chat.last_message_id
    WHERE state.user_id = :userId
      AND state.hidden_through_sequence IS NOT NULL
      AND (
        (state.left_through_sequence IS NOT NULL AND state.left_through_sequence <= state.hidden_through_sequence)
        OR
        (state.left_through_sequence IS NULL AND (message.message_sequence IS NULL OR message.message_sequence <= state.hidden_through_sequence))
      )`,
    { replacements: { userId }, type: QueryTypes.SELECT },
  );
  if (hidden.length)
    where.chats_id = { [Op.notIn]: hidden.map((state) => state.chat_id) };
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
  const [states, lastMessages, role] = await Promise.all([
    ChatUserState.findAll({
      where: {
        user_id: userId,
        chat_id: { [Op.in]: chats.rows.map((chat) => chat.chats_id) },
      },
    }),
    Message.findAll({
      where: {
        messages_id: {
          [Op.in]: chats.rows
            .map((chat) => chat.last_message_id)
            .filter(Boolean),
        },
      },
      attributes: ["messages_id", "message_sequence"],
    }),
    policy.actorRole(userId),
  ]);
  const snapshot = {
    states: new Map(states.map((state) => [state.chat_id, state])),
    lastMessages: new Map(
      lastMessages.map((message) => [message.messages_id, message]),
    ),
    role,
  };
  return {
    chats: await Promise.all(
      chats.rows.map((chat) =>
        formatChat(
          chat,
          userId,
          chat.participants.map((id) => details.get(id)).filter(Boolean),
          snapshot,
        ),
      ),
    ),
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
  let newlyCreated = false;
  const message = await sequelize.transaction(async (transaction) => {
    const chat = await getAuthorizedChat(chatId, senderId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    policy.requirePosting(chat, senderId);
    const state = await policy.userState(chatId, senderId, transaction);
    if (clientMessageId) {
      const existing = await Message.findByPk(clientMessageId, { transaction });
      if (existing) {
        if (existing.chat_id !== chatId || existing.sender_id !== senderId)
          throw chatError("Message ID is already in use");
        if (
          !policy.after(
            existing.message_sequence,
            state.cleared_through_sequence,
          )
        )
          throw chatError("This message is no longer in your history", 409);
        return existing;
      }
    }
    if (
      replyTo &&
      !(await Message.findOne({
        where: {
          messages_id: replyTo,
          chat_id: chatId,
          is_deleted: false,
          ...policy.sequenceWhere(state),
        },
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
    newlyCreated = true;
    const recipients = await User.findAll({
      where: {
        user_id: { [Op.in]: chat.participants.filter((id) => id !== senderId) },
        is_active: true,
      },
      transaction,
    });
    const sender = await User.findByPk(senderId, { transaction });
    for (const recipient of recipients) {
      const role = require("./roleUtils").getRoleKey(recipient);
      const base = ["admin", "super_admin"].includes(role)
        ? "/admin"
        : `/dashboard/${role === "project_manager" ? "pm" : role}`;
      await Notification.create(
        {
          user_id: recipient.user_id,
          chat_message_id: created.messages_id,
          title: [sender.first_name, sender.last_name]
            .filter(Boolean)
            .join(" "),
          message: text.slice(0, 250),
          action_url: `${base}/messages?chat=${chatId}`,
          metadata: {
            chat_id: chatId,
            message_id: created.messages_id,
            message_sequence: String(created.message_sequence),
            kind: "chat_message",
          },
        },
        { transaction },
      );
    }
    return created;
  });
  const result = await findMessage(message.messages_id, senderId);
  if (!result)
    throw chatError("This message is no longer in your history", 409);
  Object.defineProperty(result, "_is_new", { value: newlyCreated });
  return result;
};

const getChatMessages = async (chatId, userId, options = {}) => {
  await getAccessibleChat(chatId, userId);
  const { page, limit, offset } = pagination(options);
  const state = await policy.userState(chatId, userId);
  const where = {
    chat_id: chatId,
    is_deleted: false,
    ...policy.sequenceWhere(state),
  };
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
    messages: (
      await Promise.all(
        messages.rows
          .reverse()
          .map((message) => formatMessage(message, userId)),
      )
    ).filter(Boolean),
    pagination: pageInfo(messages.count, page, limit),
  };
};

const markMessagesAsRead = async (chatId, userId, messageIds = []) => {
  if (!Array.isArray(messageIds) || messageIds.length > 500)
    throw chatError("Message IDs must be an array of at most 500 items");
  messageIds.forEach((id) => validateId(id, "message ID"));
  return sequelize.transaction(async (transaction) => {
    const chat = await getAccessibleChat(chatId, userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const state = await policy.userState(chatId, userId, transaction);
    const where = {
      ...policy.sequenceWhere(state),
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
    const readMessages = await Message.findAll({
      where,
      attributes: ["messages_id"],
      transaction,
    });
    await Notification.update(
      { is_read: true, read_at: new Date() },
      {
        where: {
          user_id: userId,
          chat_message_id: { [Op.in]: readMessages.map((m) => m.messages_id) },
        },
        transaction,
      },
    );
    // Recalculate for partial reads as well; marking all read also persists receipts.
    const unread = await Message.count({
      where: {
        ...policy.sequenceWhere(state, true),
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
    const hasLeft = state.left_through_sequence !== null;
    if (!hasLeft)
      await chat.update(
        { unread_counts: { ...chat.unread_counts, [userId]: unread } },
        { transaction, silent: true },
      );
    return {
      chat_id: chatId,
      user_id: userId,
      message_ids: messageIds,
      unread_count: hasLeft ? 0 : unread,
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
    const state = await policy.userState(chat.chats_id, userId, transaction);
    if (!policy.after(message.message_sequence, state.cleared_through_sequence))
      throw chatError("Message not found", 404);
    if (message.sender_id !== userId)
      throw chatError("Only the sender can change this message", 403);
    if (message.is_deleted) throw chatError("Message not found", 404);
    if (!deleting) policy.requirePosting(chat, userId);
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
      await Notification.update(
        { message: "This message was deleted" },
        { where: { chat_message_id: messageId }, transaction },
      );
      const counts = { ...chat.unread_counts };
      const memberStates = new Map(
        (
          await ChatUserState.findAll({
            where: { chat_id: chat.chats_id },
            transaction,
          })
        ).map((state) => [state.user_id, state]),
      );
      for (const id of chat.participants)
        if (
          id !== userId &&
          !message.read_by?.[id] &&
          policy.after(
            message.message_sequence,
            policy.unreadBoundary(
              memberStates.get(id) || {
                cleared_through_sequence: "0",
                unread_since_sequence: "0",
              },
            ),
          )
        )
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
  const result = await findMessage(messageId, userId);
  if (!result)
    throw chatError("This message is no longer in your history", 409);
  return result;
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
  const archived = await ChatUserState.findAll({
    where: { user_id: userId, left_through_sequence: { [Op.ne]: null } },
    attributes: ["chat_id"],
  });
  const archivedIds = archived.map((state) => state.chat_id);
  const userChats = await Chat.findAll({
    where: {
      is_active: true,
      [Op.or]: [
        { participants: { [Op.contains]: [userId] } },
        ...(archivedIds.length ? [{ chats_id: { [Op.in]: archivedIds } }] : []),
      ],
    },
    attributes: ["chats_id"],
  });
  const ids = userChats.map((chat) => chat.chats_id);
  if (options.chat_id) {
    validateId(options.chat_id, "chat ID");
    if (!ids.includes(options.chat_id))
      throw chatError("Chat not found or access denied", 404);
  }
  const states = await ChatUserState.findAll({
    where: { user_id: userId, chat_id: { [Op.in]: ids } },
  });
  const boundaries = new Map(states.map((state) => [state.chat_id, state]));
  const messages = await Message.findAndCountAll({
    where: {
      content: { [Op.iLike]: `%${query.trim()}%` },
      is_deleted: false,
      [Op.or]: (options.chat_id ? [options.chat_id] : ids).map((id) => ({
        chat_id: id,
        ...policy.sequenceWhere(
          boundaries.get(id) || { cleared_through_sequence: "0" },
        ),
      })),
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
    messages: (
      await Promise.all(
        messages.rows.map((message) => formatMessage(message, userId)),
      )
    ).filter(Boolean),
    pagination: pageInfo(messages.count, page, limit),
  };
};

module.exports = {
  findMessage,
  createChat,
  getUserChats,
  getAvailableUsers,
  getChatDetails,
  getAuthorizedChat,
  getAccessibleChat,
  sendMessage,
  getChatMessages,
  markMessagesAsRead,
  editMessage,
  deleteMessage,
  searchMessages,
};
