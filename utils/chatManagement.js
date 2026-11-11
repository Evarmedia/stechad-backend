const { Op } = require("sequelize");
const sequelize = require("../config/database");
const {
  ChatUserState,
  Message,
  Notification,
  User,
  Department,
  ProjectManager,
} = require("../models");
const chatUtil = require("./chatUtil");
const policy = require("./chatPolicy");
const { ROLE_INCLUDE } = require("./roleUtils");
const validateId = (id) => {
  if (
    typeof id !== "string" ||
    !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)
  )
    throw policy.chatError("Invalid participant ID");
};
const latestSequence = async (chatId, transaction) =>
  String(
    (
      await Message.findOne({
        where: { chat_id: chatId },
        attributes: ["message_sequence"],
        order: [["message_sequence", "DESC"]],
        transaction,
      })
    )?.message_sequence || 0,
  );
const visibleLatestSequence = async (chatId, userId, transaction) => {
  const latest = await latestSequence(chatId, transaction);
  const state = await policy.userState(chatId, userId, transaction);
  if (state.left_through_sequence === null) return latest;
  return BigInt(latest) < BigInt(state.left_through_sequence)
    ? latest
    : String(state.left_through_sequence);
};
async function deleteNotifications(chatId, userId, transaction, boundary) {
  await sequelize.query(
    `DELETE FROM ${policy.quoteTable("notifications")} n USING ${policy.quoteTable("messages")} m
    WHERE n.chat_message_id = m.messages_id AND n.user_id = :userId AND m.chat_id = :chatId ${boundary === undefined ? "" : "AND m.message_sequence <= :boundary"}`,
    { replacements: { userId, chatId, boundary }, transaction },
  );
}
async function clearHistory(chatId, userId) {
  return sequelize.transaction(async (transaction) => {
    const chat = await chatUtil.getAccessibleChat(chatId, userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const boundary = await visibleLatestSequence(chatId, userId, transaction);
    const previous = await policy.userState(chatId, userId, transaction);
    await ChatUserState.upsert(
      {
        chat_id: chatId,
        user_id: userId,
        cleared_through_sequence: boundary,
        unread_since_sequence: previous.unread_since_sequence,
        hidden_through_sequence: null,
      },
      { transaction },
    );
    if (chat.participants.includes(userId))
      await chat.update(
        { unread_counts: { ...chat.unread_counts, [userId]: 0 } },
        { transaction, silent: true },
      );
    await deleteNotifications(chatId, userId, transaction, boundary);
    return { chat_id: chatId, cleared_through_sequence: boundary };
  });
}
async function deleteForUser(chatId, userId) {
  return sequelize.transaction(async (transaction) => {
    const chat = await chatUtil.getAccessibleChat(chatId, userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    const boundary = await visibleLatestSequence(chatId, userId, transaction);
    const previous = await policy.userState(chatId, userId, transaction);
    await ChatUserState.upsert(
      {
        chat_id: chatId,
        user_id: userId,
        cleared_through_sequence: boundary,
        unread_since_sequence: previous.unread_since_sequence,
        hidden_through_sequence: boundary,
      },
      { transaction },
    );
    if (chat.participants.includes(userId))
      await chat.update(
        { unread_counts: { ...chat.unread_counts, [userId]: 0 } },
        { transaction, silent: true },
      );
    await deleteNotifications(chatId, userId, transaction);
    let purged = false;
    const participantIds = [...chat.participants];
    if (chat.chat_type === "direct") {
      const states = await ChatUserState.findAll({
        where: { chat_id: chatId, user_id: { [Op.in]: participantIds } },
        transaction,
      });
      const byUser = new Map(states.map((state) => [state.user_id, state]));
      purged = participantIds.every((id) => {
        const state = byUser.get(id);
        return (
          state &&
          state.hidden_through_sequence !== null &&
          BigInt(state.hidden_through_sequence) >= BigInt(boundary)
        );
      });
      if (purged) {
        const messageIds = (
          await Message.findAll({
            where: { chat_id: chatId },
            attributes: ["messages_id"],
            transaction,
          })
        ).map((message) => message.messages_id);
        if (messageIds.length)
          await Notification.destroy({
            where: { chat_message_id: { [Op.in]: messageIds } },
            transaction,
          });
        await ChatUserState.destroy({
          where: { chat_id: chatId },
          transaction,
        });
        await Message.destroy({ where: { chat_id: chatId }, transaction });
        await chat.destroy({ transaction });
      }
    }
    return {
      chat_id: chatId,
      cleared_through_sequence: boundary,
      hidden_through_sequence: boundary,
      purged,
      purged_for_user_ids: purged ? participantIds : [],
    };
  });
}
async function leaveGroup(chatId, userId) {
  await sequelize.transaction(async (transaction) => {
    const chat = await chatUtil.getAuthorizedChat(chatId, userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (chat.chat_type === "direct")
      throw policy.chatError("Direct conversations cannot be left", 400);
    if (chat.created_by === userId)
      throw policy.chatError(
        "The group creator cannot leave without transferring ownership",
        403,
      );
    const boundary = await latestSequence(chatId, transaction);
    const previous = await policy.userState(chatId, userId, transaction);
    const counts = { ...chat.unread_counts };
    delete counts[userId];
    await ChatUserState.upsert(
      {
        chat_id: chatId,
        user_id: userId,
        cleared_through_sequence: previous.cleared_through_sequence,
        unread_since_sequence: previous.unread_since_sequence,
        hidden_through_sequence: null,
        left_through_sequence: boundary,
      },
      { transaction },
    );
    await chat.update(
      {
        participants: chat.participants.filter((id) => id !== userId),
        unread_counts: counts,
      },
      { transaction },
    );
    await deleteNotifications(chatId, userId, transaction);
  });
  return chatUtil.getChatDetails(chatId, userId);
}
async function managedWrite(chatId, userId, operation) {
  await sequelize.transaction(async (transaction) => {
    const chat = await chatUtil.getAuthorizedChat(chatId, userId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    await policy.requireManager(chat, userId, transaction);
    await operation(chat, transaction);
  });
  return chatUtil.getChatDetails(chatId, userId);
}
async function updateSettings(chatId, userId, input) {
  const allowed = ["chat_name", "description", "posting_policy"];
  if (Object.keys(input).some((key) => !allowed.includes(key)))
    throw policy.chatError("Unsupported group setting");
  if (
    input.chat_name !== undefined &&
    (typeof input.chat_name !== "string" ||
      !input.chat_name.trim() ||
      input.chat_name.trim().length > 100)
  )
    throw policy.chatError("Group name must be between 1 and 100 characters");
  if (
    input.description !== undefined &&
    (typeof input.description !== "string" || input.description.length > 1000)
  )
    throw policy.chatError("Description must be at most 1,000 characters");
  if (
    input.posting_policy !== undefined &&
    !["all_members", "creator_only"].includes(input.posting_policy)
  )
    throw policy.chatError("Invalid posting policy");
  return managedWrite(chatId, userId, (chat, transaction) =>
    chat.update(
      {
        ...input,
        ...(input.chat_name === undefined
          ? {}
          : { chat_name: input.chat_name.trim() }),
      },
      { transaction },
    ),
  );
}
async function addMembers(chatId, userId, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 99)
    throw policy.chatError("Choose between 1 and 99 members");
  ids.forEach(validateId);
  return managedWrite(chatId, userId, async (chat, transaction) => {
    const added = [...new Set(ids)].filter(
      (id) => !chat.participants.includes(id),
    );
    if (chat.participants.length + added.length > 100)
      throw policy.chatError("Groups have a maximum of 100 members");
    await policy.requireContacts(added, userId, "group", transaction);
    const baseline = await latestSequence(chatId, transaction);
    const counts = { ...chat.unread_counts };
    for (const id of added) {
      const previous = await policy.userState(chatId, id, transaction);
      await ChatUserState.upsert(
        {
          chat_id: chatId,
          user_id: id,
          cleared_through_sequence: previous.cleared_through_sequence,
          unread_since_sequence: baseline,
          hidden_through_sequence: null,
          left_through_sequence: null,
        },
        { transaction },
      );
      counts[id] = 0;
    }
    await chat.update(
      { participants: [...chat.participants, ...added], unread_counts: counts },
      { transaction },
    );
  });
}
async function removeMember(chatId, userId, targetId) {
  validateId(targetId);
  return managedWrite(chatId, userId, async (chat, transaction) => {
    if (targetId === chat.created_by)
      throw policy.chatError("The creator cannot remove themselves");
    if (!chat.participants.includes(targetId))
      throw policy.chatError("Member not found", 404);
    const counts = { ...chat.unread_counts };
    delete counts[targetId];
    await chat.update(
      {
        participants: chat.participants.filter((id) => id !== targetId),
        unread_counts: counts,
      },
      { transaction },
    );
    await deleteNotifications(chatId, targetId, transaction);
  });
}
async function participantProfile(chatId, userId, targetId) {
  validateId(targetId);
  const chat = await chatUtil.getAccessibleChat(chatId, userId);
  if (!chat.participants.includes(targetId))
    throw policy.chatError("Participant not found", 404);
  const user = await User.findByPk(targetId, {
    attributes: [
      "user_id",
      "first_name",
      "last_name",
      "avatar_object_name",
      "role_id",
      "job_title",
      "department_id",
      "city",
      "country",
    ],
    include: [
      ROLE_INCLUDE,
      { model: Department, as: "department", attributes: ["name"] },
      { model: ProjectManager, as: "project_manager", attributes: ["company"] },
    ],
  });
  if (!user) throw policy.chatError("Participant not found", 404);
  let avatar_url = null;
  if (user.avatar_object_name) {
    try {
      avatar_url = await require("../config/gcpStorage").getV4ReadSignedUrl(
        user.avatar_object_name,
      );
    } catch {}
  }
  return {
    user_id: user.user_id,
    first_name: user.first_name,
    last_name: user.last_name,
    role: policyRole(user),
    avatar_url,
    job_title: user.job_title,
    department: user.department?.name,
    company: user.project_manager?.company,
    city: user.city,
    country: user.country,
  };
}
const policyRole = (user) => require("./roleUtils").getRoleKey(user);
async function setGroupImage(chatId, userId, objectName) {
  return managedWrite(chatId, userId, (chat, transaction) =>
    chat.update({ avatar_object_name: objectName }, { transaction }),
  );
}
module.exports = {
  clearHistory,
  deleteForUser,
  leaveGroup,
  updateSettings,
  addMembers,
  removeMember,
  participantProfile,
  setGroupImage,
};
