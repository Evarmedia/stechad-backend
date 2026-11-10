const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");

// Every run uses a new schema; no configured application database is imported.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
if (!databaseUrl) {
  test(
    "PostgreSQL chat integration (set CHAT_TEST_DATABASE_URL to run)",
    { skip: true },
    () => {},
  );
} else {
  const { Sequelize } = require("sequelize");
  const schema = `chat_test_${randomUUID().replace(/-/g, "")}`;
  const database = new Sequelize(databaseUrl, { logging: false, schema });
  database.schema = schema;
  const databasePath = require.resolve("../config/database");
  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: database,
  };
  const { Chat, Message, User, Role, Reward } = require("../models");
  const chat = require("../utils/chatUtil");
  const { migrateRoleStorage } = require("../utils/roleMigration");
  const createDefaultRewards = require("../seeders/referralRewards");
  const express = require("express");
  const http = require("node:http");
  const { Server } = require("socket.io");
  const { io: connectSocket } = require("socket.io-client");
  const jwt = require("jsonwebtoken");
  const { initializeChatSocket } = require("../utils/chatSocket");
  let alice, bob, outsider, inactive, server, realtime, origin;
  const sockets = new Set();
  const secret = randomUUID();
  process.env.JWT_SECRET = secret;
  process.env.JWT_REFRESH_SECRET = randomUUID();

  before(async () => {
    await database.createSchema(schema);
    await migrateRoleStorage();
    await database.sync({ alter: false, force: false });
    await migrateRoleStorage();
    if ((await Reward.count()) === 0) await createDefaultRewards();
    assert.equal(
      await Reward.count(),
      2,
      "fresh database seeds default rewards",
    );
    if ((await Reward.count()) === 0) await createDefaultRewards();
    assert.equal(await Reward.count(), 2, "restart does not duplicate rewards");
    const role = await Role.findOne({ where: { role_key: "staff" } });
    [alice, bob, outsider, inactive] = await Promise.all(
      ["Alice", "Bob", "Outsider", "Inactive"].map((first_name) =>
        User.create({
          first_name,
          last_name: "Tester",
          email: `${first_name}@example.test`,
          role_id: role.role_id,
          is_active: first_name !== "Inactive",
        }),
      ),
    );
    const app = express();
    app.use(express.json());
    app.post(
      "/api/auth/refresh-token",
      require("../controllers/sessionController").refreshAccessToken,
    );
    server = http.createServer(app);
    realtime = new Server(server);
    initializeChatSocket(realtime);
    app.set("io", realtime);
    app.use("/api/chat", require("../routes/chatRoutes"));
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    sockets.forEach((socket) => socket.disconnect());
    if (realtime) await new Promise((resolve) => realtime.close(resolve));
    try {
      await database.dropSchema(schema, { cascade: true });
    } finally {
      await database.close();
    }
  });
  const token = (user) =>
    jwt.sign({ user_id: user.user_id }, secret, { expiresIn: "5m" });
  const request = async (user, path = "", method = "GET", body) => {
    const response = await fetch(`${origin}/api/chat${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token(user)}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...(await response.json()) };
  };
  const connect = async (user) => {
    const socket = connectSocket(origin, {
      auth: { token: token(user) },
      transports: ["websocket"],
      reconnection: false,
      autoConnect: false,
    });
    sockets.add(socket);
    const ready = once(socket, "connect");
    socket.connect();
    await ready;
    return socket;
  };
  const event = (socket, name) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.off(name, handle);
        reject(new Error(`Timed out waiting for ${name}`));
      }, 3000);
      const handle = (data) => {
        clearTimeout(timer);
        resolve(data);
      };
      socket.once(name, handle);
    });
  const emit = (socket, name, payload) =>
    new Promise((resolve, reject) =>
      socket
        .timeout(3000)
        .emit(name, payload, (error, response) =>
          error ? reject(error) : resolve(response),
        ),
    );

  test("direct-chat creation is idempotent under concurrency and returns safe participant details", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        chat.createChat([bob.user_id], alice.user_id),
      ),
    );
    assert.equal(new Set(results.map((item) => item.chats_id)).size, 1);
    assert.equal(results[0].participant_details.length, 2);
    assert.equal(results[0].participant_details[0].password, undefined);
    assert.equal(results[0].participant_details[0].email, undefined);
    assert.equal(typeof results[0].participant_details[0].role, "string");
    await assert.rejects(chat.createChat([], alice.user_id), { status: 400 });
    await assert.rejects(chat.createChat([inactive.user_id], alice.user_id), {
      status: 400,
    });
    await assert.rejects(
      chat.createChat([bob.user_id, outsider.user_id], alice.user_id),
      { status: 400 },
    );
    await assert.rejects(
      chat.createChat([bob.user_id], alice.user_id, "group", ""),
      { status: 400 },
    );
  });
  test("message writes, unread counts and partial/all read receipts stay consistent", async () => {
    const conversation = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Unread regression",
    );
    const sent = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        chat.sendMessage(conversation.chats_id, alice.user_id, `Message ${i}`),
      ),
    );
    assert.equal(
      (await Chat.findByPk(conversation.chats_id)).unread_counts[bob.user_id],
      6,
    );
    const receipt = await chat.markMessagesAsRead(
      conversation.chats_id,
      bob.user_id,
      [sent[0].messages_id],
    );
    assert.equal(receipt.unread_count, 5);
    assert.ok(
      (await Message.findByPk(sent[0].messages_id)).read_by[bob.user_id],
    );
    await chat.markMessagesAsRead(conversation.chats_id, bob.user_id);
    assert.equal(
      (await Chat.findByPk(conversation.chats_id)).unread_counts[bob.user_id],
      0,
    );
    for (const message of sent)
      assert.ok(
        (await Message.findByPk(message.messages_id)).read_by[bob.user_id],
      );
  });
  test("retrying with the same client message ID does not duplicate a message or unread count", async () => {
    const conversation = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Safe retries",
    );
    const id = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 3 }, () =>
        chat.sendMessage(
          conversation.chats_id,
          alice.user_id,
          "Send exactly once",
          "text",
          [],
          null,
          id,
        ),
      ),
    );
    assert.deepEqual(
      results.map((message) => message.messages_id),
      [id, id, id],
    );
    assert.equal(
      await Message.count({ where: { chat_id: conversation.chats_id } }),
      1,
    );
    assert.equal(
      (await Chat.findByPk(conversation.chats_id)).unread_counts[bob.user_id],
      1,
    );
    await assert.rejects(
      chat.sendMessage(
        conversation.chats_id,
        bob.user_id,
        "Cannot reuse another sender’s ID",
        "text",
        [],
        null,
        id,
      ),
      { status: 400 },
    );
  });
  test("membership protects history, searches, receipts and cross-chat replies", async () => {
    const conversation = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Private",
    );
    const message = await chat.sendMessage(
      conversation.chats_id,
      alice.user_id,
      "Private search phrase",
    );
    await Promise.all(
      [
        chat.getChatMessages(conversation.chats_id, outsider.user_id),
        chat.sendMessage(conversation.chats_id, outsider.user_id, "Intrusion"),
        chat.markMessagesAsRead(conversation.chats_id, outsider.user_id),
        chat.searchMessages(outsider.user_id, "Private", {
          chat_id: conversation.chats_id,
        }),
      ].map((operation) => assert.rejects(operation, { status: 404 })),
    );
    const other = await chat.createChat([outsider.user_id], alice.user_id);
    await assert.rejects(
      chat.sendMessage(
        other.chats_id,
        alice.user_id,
        "Invalid reply",
        "text",
        [],
        message.messages_id,
      ),
      { status: 400 },
    );
    await assert.rejects(
      chat.sendMessage(conversation.chats_id, alice.user_id, "  "),
      { status: 400 },
    );
    await assert.rejects(chat.getChatMessages("invalid", alice.user_id), {
      status: 400,
    });
    await assert.rejects(
      chat.getChatMessages(conversation.chats_id, alice.user_id, { limit: -1 }),
      { status: 400 },
    );
  });
  test("cursor pagination includes all messages with equal timestamps", async () => {
    const conversation = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Pagination",
    );
    const timestamp = new Date("2026-01-01T10:00:00Z");
    await Message.bulkCreate(
      Array.from({ length: 7 }, (_, i) => ({
        chat_id: conversation.chats_id,
        sender_id: alice.user_id,
        content: `History ${i}`,
        timestamp,
      })),
    );
    const ids = new Set();
    let filters = { limit: 3 };
    for (let i = 0; i < 3; i++) {
      const result = await chat.getChatMessages(
        conversation.chats_id,
        bob.user_id,
        filters,
      );
      result.messages.forEach((message) => {
        assert.ok(!ids.has(message.messages_id));
        ids.add(message.messages_id);
      });
      filters = {
        limit: 3,
        before_timestamp: result.messages[0].timestamp,
        before_id: result.messages[0].messages_id,
      };
    }
    assert.equal(ids.size, 7);
  });
  test("edit/delete preserve sender permissions, inbox previews and quoted-message privacy", async () => {
    const conversation = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Editing",
    );
    const original = await chat.sendMessage(
      conversation.chats_id,
      alice.user_id,
      "Original",
    );
    await assert.rejects(
      chat.editMessage(original.messages_id, bob.user_id, "No"),
      { status: 403 },
    );
    await chat.editMessage(original.messages_id, alice.user_id, "Updated");
    assert.equal(
      (await Chat.findByPk(conversation.chats_id)).last_message_content,
      "Updated",
    );
    const reply = await chat.sendMessage(
      conversation.chats_id,
      bob.user_id,
      "Reply",
      "text",
      [],
      original.messages_id,
    );
    await chat.deleteMessage(original.messages_id, alice.user_id);
    const history = await chat.getChatMessages(
      conversation.chats_id,
      bob.user_id,
    );
    assert.equal(
      history.messages.find(
        (message) => message.messages_id === reply.messages_id,
      ).replyToMessage.content,
      "This message was deleted",
    );
    await chat.deleteMessage(reply.messages_id, bob.user_id);
    assert.equal(
      (await Chat.findByPk(conversation.chats_id)).last_message_content,
      "This message was deleted",
    );
  });
  test("static search/users routes, validation and REST realtime events work", async () => {
    const conversation = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Realtime REST",
    );
    const receiver = await connect(bob);
    const received = event(receiver, "new_message");
    const response = await request(
      alice,
      `/${conversation.chats_id}/messages`,
      "POST",
      { content: "Delivered via REST" },
    );
    assert.equal(response.status, 201);
    assert.equal(
      (await received).message.messages_id,
      response.data.messages_id,
    );
    assert.equal(
      (
        await request(
          bob,
          `/search?query=Delivered&chat_id=${conversation.chats_id}`,
        )
      ).data.messages.length,
      1,
    );
    const directory = await request(alice, "/users?search=Bob");
    assert.equal(directory.status, 200);
    assert.equal(directory.data.users.length, 1);
    assert.equal((await request(alice, "", "POST", {})).status, 400);
    assert.equal(
      (await request(outsider, `/${conversation.chats_id}/messages`)).status,
      404,
    );
    receiver.disconnect();
  });
  test("sockets validate rooms and typing, deliver messages without room joins, and support multiple tabs", async () => {
    const conversation = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Realtime sockets",
    );
    const sender = await connect(alice);
    const receiver = await connect(bob);
    const secondTab = await connect(bob);
    const intruder = await connect(outsider);
    assert.equal(
      (await emit(intruder, "join_chat", conversation.chats_id)).success,
      false,
    );
    assert.equal(
      (await emit(intruder, "typing_start", { chat_id: conversation.chats_id }))
        .success,
      false,
    );
    const received = event(receiver, "new_message");
    const secondReceived = event(secondTab, "new_message");
    const typing = event(receiver, "user_typing");
    assert.equal(
      (await emit(sender, "typing_start", { chat_id: conversation.chats_id }))
        .success,
      true,
    );
    assert.equal((await typing).user_id, alice.user_id);
    const result = await emit(sender, "send_message", {
      chat_id: conversation.chats_id,
      content: "Live message",
    });
    assert.equal(result.success, true);
    assert.equal(
      (await received).message.messages_id,
      result.message.messages_id,
    );
    assert.equal(
      (await secondReceived).message.messages_id,
      result.message.messages_id,
    );
    const receipts = event(sender, "messages_read");
    assert.equal(
      (
        await emit(receiver, "mark_messages_read", {
          chat_id: conversation.chats_id,
          message_ids: [result.message.messages_id],
        })
      ).success,
      true,
    );
    assert.equal((await receipts).user_id, bob.user_id);
    receiver.disconnect();
    const online = event(sender, "online_users");
    sender.emit("get_online_users");
    assert.ok((await online).some((person) => person.user_id === bob.user_id));
    [sender, secondTab, intruder].forEach((socket) => socket.disconnect());
  });
  test("sockets reject invalid and inactive-user tokens", async () => {
    for (const authToken of ["invalid", token(inactive)]) {
      const socket = connectSocket(origin, {
        auth: { token: authToken },
        reconnection: false,
        autoConnect: false,
      });
      sockets.add(socket);
      const failed = event(socket, "connect_error");
      socket.connect();
      assert.equal((await failed).message, "Authentication error");
      socket.disconnect();
    }
  });
  test("session refresh requires a valid refresh token and an active user", async () => {
    const refresh = async (body) =>
      fetch(`${origin}/api/auth/refresh-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const refreshToken = jwt.sign(
      { user_id: alice.user_id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "5m" },
    );
    const response = await refresh({ refresh_token: refreshToken });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(jwt.verify(result.data.token, secret).user_id, alice.user_id);
    assert.equal(
      jwt.verify(result.data.refreshToken, process.env.JWT_REFRESH_SECRET)
        .user_id,
      alice.user_id,
    );
    assert.equal((await refresh({})).status, 400);
    assert.equal((await refresh({ refresh_token: token(alice) })).status, 401);
    const inactiveRefresh = jwt.sign(
      { user_id: inactive.user_id },
      process.env.JWT_REFRESH_SECRET,
    );
    assert.equal(
      (await refresh({ refresh_token: inactiveRefresh })).status,
      401,
    );
    const expired = jwt.sign(
      { user_id: alice.user_id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: -1 },
    );
    assert.equal((await refresh({ refresh_token: expired })).status, 401);
  });
}
