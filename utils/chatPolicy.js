const { Op } = require("sequelize");
const { User, Message, ChatUserState } = require("../models");
const sequelize = require("../config/database");
const { getRoleKey, isCustomRole } = require("./roleUtils");
const chatError = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const managerRoles = ["admin", "super_admin", "project_manager"];
const actorRole = async (id, transaction) =>
  getRoleKey(await User.findByPk(id, { transaction }));
const canManage = (chat, userId, role) =>
  chat.chat_type !== "direct" &&
  chat.created_by === userId &&
  managerRoles.includes(role);
async function requireManager(chat, userId, transaction) {
  if (!canManage(chat, userId, await actorRole(userId, transaction)))
    throw chatError(
      "Only the group creator, while an admin or PM, can manage this group",
      403,
    );
}
const requirePosting = (chat, userId) => {
  if (
    chat.chat_type !== "direct" &&
    chat.posting_policy === "creator_only" &&
    chat.created_by !== userId
  )
    throw chatError("Only the creator can post in this group", 403);
};
async function contactFilter(userId, context = "direct", transaction) {
  if (!["direct", "group"].includes(context))
    throw chatError("Invalid contact context");
  const actor = await User.findByPk(userId, { transaction });
  const role = getRoleKey(actor);
  if (context === "group" && !managerRoles.includes(role))
    throw chatError("Only admins and PMs can create or manage groups", 403);
  if (["admin", "super_admin"].includes(role)) return {};
  const roles =
    role === "project_manager"
      ? ["talent", "staff", "project_manager"]
      : role === "staff" || isCustomRole(actor)
        ? ["staff", "project_manager"]
        : [];
  if (roles.length) return { [Op.or]: [{ "$role.role_key$": { [Op.in]: roles } }, { "$role.is_system$": false }] };
  if (role !== "talent") return { user_id: { [Op.in]: [] } };
  // Actual incoming direct messages survive personal clearing and soft deletion.
  const incoming = await Message.findAll({
    attributes: ["sender_id"],
    include: [
      {
        association: "chat",
        attributes: [],
        required: true,
        where: {
          chat_type: "direct",
          participants: { [Op.contains]: [userId] },
        },
      },
    ],
    where: {
      sender_id: { [Op.ne]: userId },
      message_type: { [Op.ne]: "system" },
    },
    group: ["Message.sender_id"],
    transaction,
    raw: true,
  });
  return { user_id: { [Op.in]: incoming.map((message) => message.sender_id) } };
}
async function requireContacts(ids, userId, context, transaction) {
  const filter = await contactFilter(userId, context, transaction);
  const allowed = await User.findAll({
    where: {
      [Op.and]: [filter, { user_id: { [Op.in]: ids }, is_active: true }],
    },
    attributes: ["user_id"],
    transaction,
  });
  if (allowed.length !== ids.length)
    throw chatError("One or more participants are not eligible contacts", 403);
}
async function userState(chatId, userId, transaction) {
  return (
    (await ChatUserState.findOne({
      where: { chat_id: chatId, user_id: userId },
      transaction,
    })) || {
      cleared_through_sequence: "0",
      unread_since_sequence: "0",
      hidden_through_sequence: null,
      left_through_sequence: null,
    }
  );
}
const after = (sequence, boundary) =>
  BigInt(sequence || 0) > BigInt(boundary || 0);
const visible = (sequence, state) =>
  after(sequence, state.cleared_through_sequence) &&
  (state.left_through_sequence === null ||
    state.left_through_sequence === undefined ||
    BigInt(sequence || 0) <= BigInt(state.left_through_sequence));
const unreadBoundary = (state) =>
  BigInt(state.cleared_through_sequence) > BigInt(state.unread_since_sequence)
    ? state.cleared_through_sequence
    : state.unread_since_sequence;
const sequenceWhere = (state, unread = false) => {
  const range = {
    [Op.gt]: unread ? unreadBoundary(state) : state.cleared_through_sequence,
  };
  if (
    state.left_through_sequence !== null &&
    state.left_through_sequence !== undefined
  )
    range[Op.lte] = state.left_through_sequence;
  return { message_sequence: range };
};
const quoteTable = (name) =>
  sequelize.getQueryInterface().queryGenerator.quoteTable({
    schema: sequelize.schema || "public",
    tableName: name,
  });
module.exports = {
  chatError,
  managerRoles,
  actorRole,
  canManage,
  requireManager,
  requirePosting,
  contactFilter,
  requireContacts,
  userState,
  after,
  visible,
  unreadBoundary,
  sequenceWhere,
  quoteTable,
};
