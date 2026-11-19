const jwt = require("jsonwebtoken");
const { User } = require("../models");
const {
  getAuthorizedChat,
  sendMessage,
  markMessagesAsRead,
} = require("./chatUtil");
const { publishChatEvent } = require("./chatEvents");

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
    socket.join(`user_${socket.userId}`);
    const entry = onlineUsers.get(socket.userId) || {
      user: socket.user,
      sockets: new Set(),
    };
    const wasOnline = entry.sockets.size > 0;
    entry.sockets.add(socket.id);
    onlineUsers.set(socket.userId, entry);
    if (!wasOnline)
      socket.broadcast.emit("user_online", {
        user_id: socket.userId,
        user: socket.user,
      });
    socket.emit(
      "online_users",
      [...onlineUsers.values()].map((item) => item.user),
    );

    const handle = (event, handler) =>
      socket.on(event, async (data, acknowledge) => {
        try {
          const currentUser = await User.findByPk(socket.userId);
          if (!currentUser?.is_active || currentUser.session_version !== socket.sessionVersion) {
            socket.disconnect(true);
            throw Object.assign(new Error("Session is no longer valid"), { status: 401 });
          }
          const result = await handler(data);
          if (typeof acknowledge === "function")
            acknowledge({ success: true, ...result });
        } catch (error) {
          const result = {
            success: false,
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
      await socket.join(`chat_${chatId}`);
      return { chat_id: chatId };
    });
    handle("leave_chat", async (data) => {
      const chatId = chatIdFrom(data);
      await socket.leave(`chat_${chatId}`);
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
        socket
          .to(
            chat.participants
              .filter((id) => id !== socket.userId)
              .map((id) => `user_${id}`),
          )
          .emit(outgoing, {
            chat_id: chat.chats_id,
            user_id: socket.userId,
            user_name: [socket.user.first_name, socket.user.last_name]
              .filter(Boolean)
              .join(" "),
          });
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
    socket.on("get_online_users", () =>
      socket.emit(
        "online_users",
        [...onlineUsers.values()].map((item) => item.user),
      ),
    );
    socket.on("disconnect", () => {
      entry.sockets.delete(socket.id);
      if (!entry.sockets.size) {
        onlineUsers.delete(socket.userId);
        socket.broadcast.emit("user_offline", {
          user_id: socket.userId,
          last_seen: new Date().toISOString(),
        });
      }
    });
  });
};

module.exports = { initializeChatSocket };
