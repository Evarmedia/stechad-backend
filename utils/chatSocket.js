const jwt = require("jsonwebtoken");
const { User } = require("../models");
const {
  getAuthorizedChat,
  sendMessage,
  markMessagesAsRead,
} = require("./chatUtil");
const { publishChatEvent } = require("./chatEvents");
const { resolveTenantContext, runWithTenant, runWithoutTenant } = require('../services/tenantContext');
const { userRoom, identityRoom, chatRoom, emitToUser, canDeliver } = require('./events');

const initializeChatSocket = (io) => {
  const onlineUsers = new Map();
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) throw new Error("Missing token");
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findByPk(decoded.user_id);
      if (!user?.is_active || (decoded.session_version || 0) !== user.session_version) throw new Error("Inactive user");
      socket.sessionVersion = user.session_version;
      socket.userId = user.user_id;
      const organizationId = socket.handshake.auth?.organization_id;
      if (process.env.TENANCY_ENFORCED === 'true' || organizationId) {
        socket.tenant = await runWithoutTenant(() => resolveTenantContext({ userId: user.user_id, organizationId }));
      }
      socket.user = {
        user_id: user.user_id,
        first_name: user.first_name,
        last_name: user.last_name,
      };
      next();
    } catch {
      next(new Error("Authentication error"));
    }
  });

  io.on("connection", (socket) => {
    const organizationId = socket.tenant?.organizationId;
    socket.join(userRoom(socket.userId, organizationId));
    socket.join(identityRoom(socket.userId));
    const presenceKey = `${organizationId || 'legacy'}:${socket.userId}`;
    const entry = onlineUsers.get(presenceKey) || {
      user: socket.user,
      organizationId,
      sockets: new Set(),
    };
    const wasOnline = entry.sockets.size > 0;
    entry.sockets.add(socket.id);
    onlineUsers.set(presenceKey, entry);
    const announce = async (event, payload) => {
      if (!organizationId) { socket.broadcast.emit(event, payload); return; }
      for (const peer of onlineUsers.values()) {
        if (peer.organizationId === organizationId && peer.user.user_id !== socket.userId)
          await emitToUser(io, peer.user.user_id, event, payload, organizationId);
      }
    };
    const visibleOnline = async () => {
      const peers = [...onlineUsers.values()].filter((item) => item.organizationId === organizationId);
      const visible = [];
      for (const peer of peers) if (await canDeliver(peer.user.user_id, organizationId)) visible.push(peer.user);
      return visible;
    };
    if (!wasOnline)
      void announce("user_online", {
        user_id: socket.userId,
        user: socket.user,
      }).catch((error) => console.error('Presence delivery failed:', error.message));
    void visibleOnline().then((users) => socket.emit('online_users', organizationId ? { organization_id: organizationId, users } : users)).catch((error) => console.error('Presence delivery failed:', error.message));

    const handle = (event, handler) =>
      socket.on(event, async (data, acknowledge) => {
        try {
          const currentUser = await User.findByPk(socket.userId);
          if (!currentUser?.is_active || currentUser.session_version !== socket.sessionVersion) {
            socket.disconnect(true);
            throw Object.assign(new Error("Session is no longer valid"), { status: 401 });
          }
          let result;
          if (socket.tenant) {
            socket.tenant = await runWithoutTenant(() => resolveTenantContext({ userId: socket.userId, organizationId }));
            result = await runWithTenant(socket.tenant, () => handler(data));
          } else result = await handler(data);
          if (typeof acknowledge === "function")
            acknowledge({ success: true, ...result, ...(organizationId ? { organization_id: organizationId } : {}) });
        } catch (error) {
          const result = {
            success: false,
            ...(organizationId ? { organization_id: organizationId } : {}),
            error: error.status
              ? error.message
              : "Unable to complete chat action",
            status: error.status || 500,
          };
          if (!error.status) console.error(`Socket ${event} failed:`, error);
          if (typeof acknowledge === "function") acknowledge(result);
          else socket.emit("chat_error", result);
        }
      });
    const chatIdFrom = (data) =>
      typeof data === "string" ? data : data?.chat_id;
    handle("join_chat", async (data) => {
      const chatId = chatIdFrom(data);
      await getAuthorizedChat(chatId, socket.userId);
      await socket.join(chatRoom(chatId));
      return { chat_id: chatId };
    });
    handle("leave_chat", async (data) => {
      const chatId = chatIdFrom(data);
      await socket.leave(chatRoom(chatId));
      return { chat_id: chatId };
    });
    handle("send_message", async (data = {}) => {
      const message = await sendMessage(
        data.chat_id,
        socket.userId,
        data.content,
        data.message_type,
        data.attachments,
        data.reply_to,
        data.client_message_id,
      );
      await publishChatEvent(io, data.chat_id, "new_message", {
        message,
      }).catch((error) => console.error("Chat notification failed:", error));
      return { message };
    });
    for (const [incoming, outgoing] of [
      ["typing_start", "user_typing"],
      ["typing_stop", "user_stopped_typing"],
    ]) {
      handle(incoming, async (data = {}) => {
        const chat = await getAuthorizedChat(data.chat_id, socket.userId);
        require("./chatPolicy").requirePosting(chat, socket.userId);
        const payload = {
            chat_id: chat.chats_id,
            user_id: socket.userId,
            user_name: [socket.user.first_name, socket.user.last_name]
              .filter(Boolean)
              .join(" "),
          };
        for (const id of chat.participants.filter((id) => id !== socket.userId)) await emitToUser(io, id, outgoing, payload, organizationId);
        return {};
      });
    }
    handle("mark_messages_read", async (data = {}) => {
      const receipt = await markMessagesAsRead(
        data.chat_id,
        socket.userId,
        data.message_ids,
      );
      await publishChatEvent(io, data.chat_id, "messages_read", receipt);
      return receipt;
    });
    handle('get_online_users', async () => { const users = await visibleOnline(); socket.emit('online_users', organizationId ? { organization_id: organizationId, users } : users); return {}; });
    socket.on("disconnect", () => {
      entry.sockets.delete(socket.id);
      if (!entry.sockets.size) {
        onlineUsers.delete(presenceKey);
        void announce("user_offline", {
          user_id: socket.userId,
          last_seen: new Date().toISOString(),
        }).catch((error) => console.error('Presence delivery failed:', error.message));
      }
    });
  });
};

module.exports = { initializeChatSocket };
