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
    await require("../utils/chatMigration").migrateChatStorage();
    await database.sync({ alter: false, force: false });
    await require("../utils/chatMigration").migrateChatStorage();
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
      ["Alice", "Bob", "Outsider", "Inactive"].map(async (first_name) =>
        User.create({
          first_name,
          last_name: "Tester",
          email: `${first_name}@example.test`,
          role_id:
            first_name === "Alice"
              ? (await Role.findOne({ where: { role_key: "admin" } })).role_id
              : role.role_id,
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
    assert.equal(typeof result.data.refreshToken, 'string');
    const rotated = await refresh({ refresh_token: result.data.refreshToken });
    assert.equal(rotated.status, 200);
    const next = await rotated.json();
    assert.equal(jwt.verify(next.data.token, secret).user_id, alice.user_id);
    assert.equal(next.data.session.session_id, result.data.session.session_id);
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
  const management = require("../utils/chatManagement");
  const { Notification, ChatUserState } = require("../models");
  const makeUser = async (roleKey, name = roleKey) =>
    User.create({
      first_name: name,
      last_name: "Policy",
      email: `${randomUUID()}@example.test`,
      role_id: (await Role.findOne({ where: { role_key: roleKey } })).role_id,
      is_active: true,
      job_title: "Design lead",
      city: "Lagos",
      country: "Nigeria",
    });
  test("all roles enforce the new-contact matrix before pagination and against forged API creation", async () => {
    const roles = [
      "admin",
      "super_admin",
      "project_manager",
      "staff",
      "talent",
    ];
    const people = Object.fromEntries(
      await Promise.all(
        roles.map(async (role) => [role, await makeUser(role)]),
      ),
    );
    const allowed = {
      admin: roles,
      super_admin: roles,
      project_manager: ["project_manager", "staff", "talent"],
      staff: ["staff", "project_manager"],
      talent: [],
    };
    for (const actor of roles) {
      for (const target of roles) {
        if (actor === "super_admin" && target === "super_admin") continue; // The database permits only one super admin.
        const other =
          actor === target ? await makeUser(target) : people[target];
        const eligible = allowed[actor].includes(target);
        const directory = await chat.getAvailableUsers(people[actor].user_id, {
          search: other.first_name,
          limit: 1,
        });
        if (!eligible)
          assert.ok(
            !directory.users.some((person) => person.user_id === other.user_id),
          );
        // Use fresh actors to keep existing direct threads from legitimately bypassing initiation rules.
        const initiator =
          actor === "super_admin" ? people.super_admin : await makeUser(actor);
        const result = await request(initiator, "", "POST", {
          participant_ids: [other.user_id],
        });
        assert.equal(
          result.status,
          eligible ? 201 : 403,
          `${actor} -> ${target}`,
        );
      }
      const directory = await chat.getAvailableUsers(people[actor].user_id, {
        limit: 100,
      });
      assert.ok(
        directory.users.every((person) => allowed[actor].includes(person.role)),
      );
      for (const chat_type of ["group", "support"]) {
        const result = await request(people[actor], "", "POST", {
          participant_ids: [(await makeUser("staff")).user_id],
          chat_type,
          chat_name: "Policy group",
        });
        assert.equal(
          result.status,
          ["admin", "super_admin", "project_manager"].includes(actor)
            ? 201
            : 403,
        );
      }
    }
    const staff = await makeUser("staff");
    const pm = await makeUser("project_manager");
    const talent = await makeUser("talent");
    await chat.createChat(
      [staff.user_id, talent.user_id],
      pm.user_id,
      "group",
      "Mixed roles",
    );
    assert.equal(
      (await chat.getAvailableUsers(staff.user_id, { search: "talent" }))
        .users.length,
      0,
    );
  });
  test("talents need an actual incoming direct message, retained after deletion and clearing", async () => {
    const talent = await makeUser("talent"),
      admin = await makeUser("admin"),
      pm = await makeUser("project_manager");
    const direct = await chat.createChat([talent.user_id], admin.user_id);
    await chat.createChat(
      [talent.user_id],
      pm.user_id,
      "group",
      "Shared group",
    );
    assert.equal(
      (await chat.getAvailableUsers(talent.user_id)).users.length,
      0,
    );
    // Existing empty threads remain replyable but do not populate the talent's picker.
    await chat.sendMessage(direct.chats_id, talent.user_id, "Existing reply");
    assert.equal(
      (await chat.getAvailableUsers(talent.user_id)).users.length,
      0,
    );
    const incoming = await chat.sendMessage(
      direct.chats_id,
      admin.user_id,
      "Actual incoming",
    );
    await chat.deleteMessage(incoming.messages_id, admin.user_id);
    await management.clearHistory(direct.chats_id, talent.user_id);
    assert.deepEqual(
      (await chat.getAvailableUsers(talent.user_id)).users.map(
        (person) => person.user_id,
      ),
      [admin.user_id],
    );
    await admin.update({ is_active: false });
    assert.equal(
      (await chat.getAvailableUsers(talent.user_id)).users.length,
      0,
    );
  });
  test("creator management, legacy support, posting restrictions and profile authorization work through REST and sockets", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff"),
      talent = await makeUser("talent"),
      otherPm = await makeUser("project_manager");
    const group = await chat.createChat(
      [staff.user_id, talent.user_id, otherPm.user_id],
      pm.user_id,
      "support",
      "Legacy support",
    );
    for (const actor of [staff, talent, otherPm]) {
      assert.equal(
        (
          await request(actor, `/${group.chats_id}`, "PATCH", {
            chat_name: "Forged",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(actor, `/${group.chats_id}/members`, "POST", {
            participant_ids: [outsider.user_id],
          })
        ).status,
        403,
      );
      assert.equal(
        (await request(actor, `/${group.chats_id}/image`, "DELETE")).status,
        403,
      );
    }
    assert.equal(
      (
        await request(pm, `/${group.chats_id}`, "PATCH", {
          created_by: otherPm.user_id,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request(pm, `/${group.chats_id}`, "PATCH", {
          description: "a".repeat(1001),
        })
      ).status,
      400,
    );
    await management.updateSettings(group.chats_id, pm.user_id, {
      chat_name: "Announcements",
      description: "Delivery updates",
      posting_policy: "creator_only",
    });
    assert.equal(
      (await chat.getChatDetails(group.chats_id, staff.user_id)).can_post,
      false,
    );
    assert.equal(
      (
        await request(staff, `/${group.chats_id}/messages`, "POST", {
          content: "Bypass",
        })
      ).status,
      403,
    );
    const socket = await connect(staff);
    assert.equal(
      (
        await emit(socket, "send_message", {
          chat_id: group.chats_id,
          content: "Socket bypass",
        })
      ).status,
      403,
    );
    assert.equal(
      (await emit(socket, "typing_start", { chat_id: group.chats_id })).status,
      403,
    );
    await chat.sendMessage(group.chats_id, pm.user_id, "Creator announcement");
    const profile = await request(
      talent,
      `/${group.chats_id}/members/${staff.user_id}/profile`,
    );
    assert.equal(profile.status, 200);
    assert.equal(profile.data.city, "Lagos");
    assert.equal(profile.data.job_title, "Design lead");
    assert.equal(profile.data.email, undefined);
    assert.equal(profile.data.phone, undefined);
    assert.equal(
      (
        await request(
          outsider,
          `/${group.chats_id}/members/${staff.user_id}/profile`,
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request(
          pm,
          `/${group.chats_id}/members/${outsider.user_id}/profile`,
        )
      ).status,
      404,
    );
    assert.equal(
      (await request(pm, `/${group.chats_id}/members/${pm.user_id}`, "DELETE"))
        .status,
      400,
    );
    await pm.update({
      role_id: (await Role.findOne({ where: { role_key: "staff" } })).role_id,
    });
    assert.equal(
      (
        await request(pm, `/${group.chats_id}`, "PATCH", {
          description: "No longer a PM",
        })
      ).status,
      403,
    );
    socket.disconnect();
  });
  test("added and re-added members see full history with no historic unread alerts; removal revokes realtime access", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff"),
      talent = await makeUser("talent");
    const group = await chat.createChat(
      [staff.user_id],
      pm.user_id,
      "group",
      "Membership",
    );
    const old = await chat.sendMessage(
      group.chats_id,
      pm.user_id,
      "Older group history",
    );
    await management.addMembers(group.chats_id, pm.user_id, [talent.user_id]);
    assert.ok(
      (
        await chat.getChatMessages(group.chats_id, talent.user_id)
      ).messages.some((message) => message.messages_id === old.messages_id),
    );
    assert.equal(
      (await chat.getChatDetails(group.chats_id, talent.user_id))
        .unread_count,
      0,
    );
    assert.equal(
      await Notification.count({ where: { user_id: talent.user_id } }),
      0,
    );
    await chat.markMessagesAsRead(group.chats_id, talent.user_id);
    const privateMessage = await chat.sendMessage(
      group.chats_id,
      pm.user_id,
      "Before clear",
    );
    await management.clearHistory(group.chats_id, talent.user_id);
    const receiver = await connect(talent);
    const revoked = event(receiver, "membership_revoked");
    assert.equal(
      (
        await request(
          pm,
          `/${group.chats_id}/members/${talent.user_id}`,
          "DELETE",
        )
      ).status,
      200,
    );
    assert.equal((await revoked).chat_id, group.chats_id);
    assert.equal(
      (await request(talent, `/${group.chats_id}/messages`)).status,
      404,
    );
    assert.equal(
      (
        await emit(receiver, "send_message", {
          chat_id: group.chats_id,
          content: "Revoked",
        })
      ).status,
      404,
    );
    let leaked = false;
    receiver.on("new_message", () => {
      leaked = true;
    });
    await request(pm, `/${group.chats_id}/messages`, "POST", {
      content: "While removed",
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(leaked, false);
    await management.addMembers(group.chats_id, pm.user_id, [talent.user_id]);
    const history = (
      await chat.getChatMessages(group.chats_id, talent.user_id)
    ).messages;
    assert.ok(history.some((message) => message.content === "While removed"));
    assert.ok(
      !history.some(
        (message) => message.messages_id === privateMessage.messages_id,
      ),
    );
    assert.equal(
      (await chat.getChatDetails(group.chats_id, talent.user_id))
        .unread_count,
      0,
    );
    await chat.markMessagesAsRead(group.chats_id, talent.user_id, [
      privateMessage.messages_id,
    ]);
    assert.equal(
      (await chat.getChatDetails(group.chats_id, talent.user_id))
        .unread_count,
      0,
    );
    receiver.disconnect();
  });
  test("personal clearing hides history, search, previews, quotes and notifications, and synchronizes tabs", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff");
    const group = await chat.createChat(
      [staff.user_id],
      pm.user_id,
      "group",
      "Private clear",
    );
    const original = await chat.sendMessage(
      group.chats_id,
      pm.user_id,
      "Confidential old content",
    );
    const tab1 = await connect(staff),
      tab2 = await connect(staff);
    const clear1 = event(tab1, "history_cleared"),
      clear2 = event(tab2, "history_cleared");
    const result = await request(staff, `/${group.chats_id}/clear`, "POST", {});
    assert.equal(
      (await clear1).cleared_through_sequence,
      result.data.cleared_through_sequence,
    );
    assert.equal(
      (await clear2).cleared_through_sequence,
      result.data.cleared_through_sequence,
    );
    assert.equal(
      (await chat.getChatMessages(group.chats_id, staff.user_id)).messages
        .length,
      0,
    );
    assert.equal(
      (await chat.searchMessages(staff.user_id, "Confidential")).messages
        .length,
      0,
    );
    const details = await chat.getChatDetails(group.chats_id, staff.user_id);
    assert.equal(details.last_message_content, null);
    assert.equal(details.unread_count, 0);
    assert.equal(
      await Notification.count({ where: { user_id: staff.user_id } }),
      0,
    );
    assert.equal(
      (await chat.getChatMessages(group.chats_id, pm.user_id)).messages.length,
      1,
    );
    await assert.rejects(
      chat.sendMessage(
        group.chats_id,
        staff.user_id,
        "Forged quote",
        "text",
        [],
        original.messages_id,
      ),
      { status: 400 },
    );
    let oldEdit = false;
    tab1.on("message_updated", () => {
      oldEdit = true;
    });
    await request(pm, `/messages/${original.messages_id}`, "PUT", {
      content: "Confidential edited",
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(oldEdit, false);
    const newMessage = event(tab1, "new_message");
    const quoted = await request(pm, `/${group.chats_id}/messages`, "POST", {
      content: "New reply",
      reply_to: original.messages_id,
    });
    assert.equal((await newMessage).message.replyToMessage, null);
    const history = (await chat.getChatMessages(group.chats_id, staff.user_id))
      .messages;
    assert.equal(history.length, 1);
    assert.equal(history[0].replyToMessage, null);
    assert.equal(history[0].reply_unavailable, true);
    assert.equal(
      (await chat.getChatMessages(group.chats_id, pm.user_id)).messages[1]
        .replyToMessage.content,
      "Confidential edited",
    );
    assert.equal(
      (await chat.getChatDetails(group.chats_id, staff.user_id)).unread_count,
      1,
    );
    assert.equal(
      await Notification.count({
        where: {
          user_id: staff.user_id,
          chat_message_id: quoted.data.messages_id,
        },
      }),
      1,
    );
    [tab1, tab2].forEach((socket) => socket.disconnect());
  });
  test("personal chat deletion hides only the caller's copy and a newer message restores it", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff");
    const direct = await chat.createChat([staff.user_id], pm.user_id);
    await chat.sendMessage(direct.chats_id, pm.user_id, "Old private history");
    const tab1 = await connect(staff),
      tab2 = await connect(staff);
    const deleted1 = event(tab1, "chat_deleted"),
      deleted2 = event(tab2, "chat_deleted");
    const response = await request(staff, `/${direct.chats_id}`, "DELETE");
    assert.equal(response.status, 200);
    assert.equal((await deleted1).chat_id, direct.chats_id);
    assert.equal((await deleted2).chat_id, direct.chats_id);
    assert.ok(
      !(await chat.getUserChats(staff.user_id)).chats.some(
        (item) => item.chats_id === direct.chats_id,
      ),
    );
    assert.ok(
      (await chat.getUserChats(pm.user_id)).chats.some(
        (item) => item.chats_id === direct.chats_id,
      ),
    );
    assert.equal(
      (await chat.getChatMessages(direct.chats_id, staff.user_id)).messages
        .length,
      0,
    );
    assert.equal(
      (await chat.searchMessages(staff.user_id, "Old private")).messages.length,
      0,
    );
    assert.equal(
      await Notification.count({
        where: {
          user_id: staff.user_id,
          chat_message_id: { [require("sequelize").Op.ne]: null },
        },
      }),
      0,
    );
    const fresh = await chat.sendMessage(
      direct.chats_id,
      pm.user_id,
      "A new message restores the chat",
    );
    const restored = (await chat.getUserChats(staff.user_id)).chats.find(
      (item) => item.chats_id === direct.chats_id,
    );
    assert.equal(restored.last_message_id, fresh.messages_id);
    assert.deepEqual(
      (await chat.getChatMessages(direct.chats_id, staff.user_id)).messages.map(
        (message) => message.messages_id,
      ),
      [fresh.messages_id],
    );
    [tab1, tab2].forEach((socket) => socket.disconnect());
  });
  test("deleting an empty chat hides it and deliberately restarting it restores the thread", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff");
    const direct = await chat.createChat([staff.user_id], pm.user_id);
    await management.deleteForUser(direct.chats_id, pm.user_id);
    assert.ok(
      !(await chat.getUserChats(pm.user_id)).chats.some(
        (item) => item.chats_id === direct.chats_id,
      ),
    );
    const restored = await chat.createChat([staff.user_id], pm.user_id);
    assert.equal(restored.chats_id, direct.chats_id);
    assert.ok(
      (await chat.getUserChats(pm.user_id)).chats.some(
        (item) => item.chats_id === direct.chats_id,
      ),
    );
  });
  test("deleting the same current direct history on both sides physically purges it", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff");
    const direct = await chat.createChat([staff.user_id], pm.user_id);
    const message = await chat.sendMessage(
      direct.chats_id,
      pm.user_id,
      "Remove this from storage",
    );
    const first = await management.deleteForUser(direct.chats_id, pm.user_id);
    assert.equal(first.purged, false);
    assert.ok(await Chat.findByPk(direct.chats_id));
    const receiver = await connect(staff);
    const purged = event(receiver, "chat_purged");
    const second = await request(staff, `/${direct.chats_id}`, "DELETE");
    assert.equal(second.status, 200);
    assert.equal(second.data.purged, true);
    assert.equal((await purged).chat_id, direct.chats_id);
    assert.equal(await Chat.count({ where: { chats_id: direct.chats_id } }), 0);
    assert.equal(
      await Message.count({ where: { chat_id: direct.chats_id } }),
      0,
    );
    assert.equal(
      await ChatUserState.count({ where: { chat_id: direct.chats_id } }),
      0,
    );
    assert.equal(
      await Notification.count({
        where: { chat_message_id: message.messages_id },
      }),
      0,
    );
    receiver.disconnect();
  });
  test("members can leave groups with a capped archive, then clear or delete it", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff");
    const group = await chat.createChat(
      [staff.user_id],
      pm.user_id,
      "group",
      "Departure archive",
    );
    const old = await chat.sendMessage(
      group.chats_id,
      pm.user_id,
      "Visible before leaving",
    );
    const receiver = await connect(staff);
    const leftEvent = event(receiver, "group_left");
    const left = await request(staff, `/${group.chats_id}/leave`, "POST", {});
    assert.equal(left.status, 200);
    assert.equal(left.data.has_left, true);
    assert.equal(left.data.can_post, false);
    assert.equal((await leftEvent).chat.has_left, true);
    assert.ok(!left.data.participants.includes(staff.user_id));
    await assert.rejects(management.leaveGroup(group.chats_id, pm.user_id), {
      status: 403,
    });
    const recent = await chat.sendMessage(
      group.chats_id,
      pm.user_id,
      "Hidden after leaving",
    );
    assert.deepEqual(
      (await chat.getChatMessages(group.chats_id, staff.user_id)).messages.map(
        (message) => message.messages_id,
      ),
      [old.messages_id],
    );
    assert.equal(
      (await chat.searchMessages(staff.user_id, "Hidden after")).messages
        .length,
      0,
    );
    assert.equal(
      (await chat.getUserChats(staff.user_id)).chats.find(
        (item) => item.chats_id === group.chats_id,
      ).last_message_id,
      old.messages_id,
    );
    await assert.rejects(
      chat.sendMessage(group.chats_id, staff.user_id, "Blocked"),
      { status: 404 },
    );
    assert.equal(
      await Notification.count({
        where: { user_id: staff.user_id, chat_message_id: recent.messages_id },
      }),
      0,
    );
    await management.clearHistory(group.chats_id, staff.user_id);
    assert.equal(
      (await chat.getChatMessages(group.chats_id, staff.user_id)).messages
        .length,
      0,
    );
    await management.deleteForUser(group.chats_id, staff.user_id);
    await chat.sendMessage(group.chats_id, pm.user_id, "Still hidden");
    assert.ok(
      !(await chat.getUserChats(staff.user_id)).chats.some(
        (item) => item.chats_id === group.chats_id,
      ),
    );
    const restored = await management.addMembers(group.chats_id, pm.user_id, [
      staff.user_id,
    ]);
    assert.equal(restored.participants.includes(staff.user_id), true);
    const details = await chat.getChatDetails(group.chats_id, staff.user_id);
    assert.equal(details.has_left, false);
    assert.equal(details.can_post, true);
    assert.ok(
      (await chat.getChatMessages(group.chats_id, staff.user_id)).messages.some(
        (message) => message.messages_id === recent.messages_id,
      ),
    );
    receiver.disconnect();
  });
  test("concurrent sends and clear have a strict sequence boundary; retries never recreate cleared notifications", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff");
    const group = await chat.createChat(
      [staff.user_id],
      pm.user_id,
      "group",
      "Concurrent clear",
    );
    const firstId = randomUUID();
    const first = await chat.sendMessage(
      group.chats_id,
      pm.user_id,
      "Retry me",
      "text",
      [],
      null,
      firstId,
    );
    await management.clearHistory(group.chats_id, staff.user_id);
    await chat.sendMessage(
      group.chats_id,
      pm.user_id,
      "Retry me",
      "text",
      [],
      null,
      firstId,
    );
    assert.equal(
      await Notification.count({ where: { user_id: staff.user_id } }),
      0,
    );
    const operations = await Promise.all([
      ...Array.from({ length: 8 }, (_, index) =>
        chat.sendMessage(group.chats_id, pm.user_id, `Concurrent ${index}`),
      ),
      management.clearHistory(group.chats_id, staff.user_id),
    ]);
    const boundary = operations.at(-1).cleared_through_sequence;
    const visible = (await chat.getChatMessages(group.chats_id, staff.user_id))
      .messages;
    const expected = operations
      .slice(0, -1)
      .filter((message) => BigInt(message.message_sequence) > BigInt(boundary));
    assert.deepEqual(
      new Set(visible.map((message) => message.messages_id)),
      new Set(expected.map((message) => message.messages_id)),
    );
    assert.equal(
      (await chat.getChatDetails(group.chats_id, staff.user_id)).unread_count,
      expected.length,
    );
    await management.clearHistory(group.chats_id, pm.user_id);
    await assert.rejects(
      chat.sendMessage(
        group.chats_id,
        pm.user_id,
        "Retry me",
        "text",
        [],
        null,
        firstId,
      ),
      { status: 409 },
    );
    assert.ok(BigInt(first.message_sequence) <= BigInt(boundary));
  });
  test("message notifications are durable, deduplicated and deep linked; reading synchronizes notification history", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff");
    const direct = await chat.createChat([staff.user_id], pm.user_id);
    const receiver = await connect(staff);
    const received = event(receiver, "notification_created");
    const id = randomUUID();
    const result = await request(pm, `/${direct.chats_id}/messages`, "POST", {
      content: "Alert me",
      client_message_id: id,
    });
    const notification = (await received).notification;
    assert.equal(notification.chat_message_id, result.data.messages_id);
    assert.equal(
      notification.action_url,
      `/dashboard/staff/messages?chat=${direct.chats_id}`,
    );
    await request(pm, `/${direct.chats_id}/messages`, "POST", {
      content: "Alert me",
      client_message_id: id,
    });
    assert.equal(
      await Notification.count({
        where: { user_id: staff.user_id, chat_message_id: id },
      }),
      1,
    );
    const changed = event(receiver, "notifications_changed");
    await request(staff, `/${direct.chats_id}/read`, "POST", {});
    await changed;
    assert.equal(
      (await Notification.findByPk(notification.notifications_id)).is_read,
      true,
    );
    receiver.disconnect();
  });
  test("the additive migration upgrades a legacy schema twice without sync or losing messages and creators", async () => {
    const originalSchema = database.schema;
    const legacy = `chat_legacy_${randomUUID().replace(/-/g, "")}`;
    const quote = (value) =>
      database.getQueryInterface().queryGenerator.quoteIdentifier(value);
    const table = (name) => `${quote(legacy)}.${quote(name)}`;
    await database.createSchema(legacy);
    try {
      await database.query(
        `CREATE TABLE ${table("users")} (user_id UUID PRIMARY KEY)`,
      );
      await database.query(
        `CREATE TABLE ${table("chats")} (chats_id UUID PRIMARY KEY, created_by UUID NOT NULL)`,
      );
      await database.query(
        `CREATE TABLE ${table("messages")} (messages_id UUID PRIMARY KEY, chat_id UUID, content TEXT)`,
      );
      await database.query(
        `CREATE TABLE ${table("notifications")} (notifications_id UUID PRIMARY KEY, user_id UUID)`,
      );
      const chatId = randomUUID(),
        messageId = randomUUID();
      await database.query(
        `INSERT INTO ${table("chats")} VALUES (:id, :creator)`,
        { replacements: { id: chatId, creator: alice.user_id } },
      );
      await database.query(
        `INSERT INTO ${table("messages")} VALUES (:id, :chat, 'Legacy history')`,
        { replacements: { id: messageId, chat: chatId } },
      );
      database.schema = legacy;
      const migrate = require("../utils/chatMigration").migrateChatStorage;
      await migrate();
      await migrate();
      const rows = await database.query(`SELECT * FROM ${table("messages")}`, {
        type: require("sequelize").QueryTypes.SELECT,
      });
      assert.equal(rows[0].content, "Legacy history");
      assert.ok(BigInt(rows[0].message_sequence) > 0n);
      const chats = await database.query(`SELECT * FROM ${table("chats")}`, {
        type: require("sequelize").QueryTypes.SELECT,
      });
      assert.equal(chats[0].created_by, alice.user_id);
      assert.equal(chats[0].posting_policy, "all_members");
    } finally {
      database.schema = originalSchema;
      await database.dropSchema(legacy, { cascade: true });
    }
  });
  test("the versioned Sequelize chat lifecycle migration is idempotent", async () => {
    const migration = require("../migrations/20261110233000-chat-user-lifecycle");
    const queryInterface = database.getQueryInterface();
    await migration.up(queryInterface, require("sequelize"));
    await migration.up(queryInterface, require("sequelize"));
    const columns = await queryInterface.describeTable({
      schema,
      tableName: "chat_user_states",
    });
    assert.ok(columns.hidden_through_sequence);
    assert.ok(columns.left_through_sequence);
    const indexes = await queryInterface.showIndex({
      schema,
      tableName: "chat_user_states",
    });
    assert.ok(
      indexes.some((index) => index.name === "chat_user_states_hidden_by_user"),
    );
    assert.ok(
      indexes.some((index) => index.name === "chat_user_states_left_by_user"),
    );
  });
  test("group member limits, contextual picker filtering, and image upload authorization are enforced", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff"),
      admin = await makeUser("admin");
    const group = await chat.createChat(
      [staff.user_id],
      pm.user_id,
      "group",
      "Images and limits",
    );
    assert.equal(
      (
        await request(pm, `/${group.chats_id}/members`, "POST", {
          participant_ids: [admin.user_id],
        })
      ).status,
      403,
    );
    assert.equal(
      (await request(staff, `/users?context=group&chat_id=${group.chats_id}`))
        .status,
      403,
    );
    const picker = await chat.getAvailableUsers(pm.user_id, {
      context: "group",
      chat_id: group.chats_id,
      limit: 100,
    });
    assert.ok(
      picker.users.every(
        (person) => !group.participants.includes(person.user_id),
      ),
    );
    const uploadPath = require.resolve("../middleware/upload");
    const previousUpload = require.cache[uploadPath];
    const gcp = require("../config/gcpStorage");
    const previousSign = gcp.getV4ReadSignedUrl;
    let writes = 0,
      deletes = 0;
    require.cache[uploadPath] = {
      id: uploadPath,
      filename: uploadPath,
      loaded: true,
      exports: {
        uploadToGCP: async () => {
          writes++;
          return { objectName: "groups/test.png" };
        },
        deleteFromGCP: async () => {
          deletes++;
        },
      },
    };
    gcp.getV4ReadSignedUrl = async () =>
      "https://storage.example.test/signed-image";
    try {
      const upload = async (actor, bytes, type) => {
        const form = new FormData();
        form.append("avatar", new Blob([bytes], { type }), "group.png");
        return fetch(`${origin}/api/chat/${group.chats_id}/image`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token(actor)}` },
          body: form,
        });
      };
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFv8AAAAASUVORK5CYII=",
        "base64",
      );
      assert.equal((await upload(staff, png, "image/png")).status, 403);
      assert.equal(writes, 0);
      assert.equal((await upload(pm, "<svg/>", "image/svg+xml")).status, 400);
      assert.equal((await upload(pm, "not a PNG", "image/png")).status, 400);
      assert.equal(
        (await upload(pm, Buffer.alloc(2 * 1024 * 1024 + 1), "image/png"))
          .status,
        400,
      );
      const response = await upload(pm, png, "image/png");
      assert.equal(response.status, 200);
      assert.equal(
        (await response.json()).data.avatar_url,
        "https://storage.example.test/signed-image",
      );
      assert.equal(
        (await Chat.findByPk(group.chats_id)).avatar_object_name,
        "groups/test.png",
      );
      assert.equal(writes, 1);
      assert.equal(
        (await request(pm, `/${group.chats_id}/image`, "DELETE")).status,
        200,
      );
      assert.equal(deletes, 1);
    } finally {
      gcp.getV4ReadSignedUrl = previousSign;
      if (previousUpload) require.cache[uploadPath] = previousUpload;
      else delete require.cache[uploadPath];
    }
    const roleId = (await Role.findOne({ where: { role_key: "staff" } }))
      .role_id;
    const users = await User.bulkCreate(
      Array.from({ length: 98 }, () => ({
        first_name: "Limit",
        last_name: "Member",
        email: `${randomUUID()}@example.test`,
        role_id: roleId,
        is_active: true,
      })),
    );
    await management.addMembers(
      group.chats_id,
      pm.user_id,
      users.map((person) => person.user_id),
    );
    assert.equal(
      (await Chat.findByPk(group.chats_id)).participants.length,
      100,
    );
    assert.equal(
      (
        await request(pm, `/${group.chats_id}/members`, "POST", {
          participant_ids: [outsider.user_id],
        })
      ).status,
      400,
    );
  });

  test("migration repairs a lagging sequence and REST/socket sends resume without renumbering history", async () => {
    const group = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Sequence recovery",
    );
    const original = await chat.sendMessage(
      group.chats_id,
      alice.user_id,
      "Preserved history",
    );
    const table = (name) =>
      database
        .getQueryInterface()
        .queryGenerator.quoteTable({ schema, tableName: name });
    const rewind = () =>
      database.query(
        `ALTER SEQUENCE ${table("chat_message_sequence")} RESTART WITH ${BigInt(original.message_sequence)}`,
      );
    await rewind();
    await assert.rejects(
      chat.sendMessage(group.chats_id, alice.user_id, "Reproduce collision"),
      { name: "SequelizeUniqueConstraintError" },
    );
    await rewind();
    const migrate = require("../utils/chatMigration").migrateChatStorage;
    await Promise.all([migrate(), migrate()]);
    assert.equal(
      (await Message.findByPk(original.messages_id)).message_sequence,
      original.message_sequence,
    );
    const receiver = await connect(bob);
    const received = event(receiver, "new_message");
    const sent = await request(alice, `/${group.chats_id}/messages`, "POST", {
      content: "REST send recovered",
    });
    assert.equal(sent.status, 201);
    assert.ok(
      BigInt(sent.data.message_sequence) > BigInt(original.message_sequence),
    );
    assert.equal((await received).message.messages_id, sent.data.messages_id);
    const socketSend = await emit(receiver, "send_message", {
      chat_id: group.chats_id,
      content: "Socket send recovered",
    });
    assert.equal(socketSend.success, true);
    assert.ok(
      BigInt(socketSend.message.message_sequence) >
        BigInt(sent.data.message_sequence),
    );
    assert.equal(
      await Notification.count({
        where: { user_id: bob.user_id, chat_message_id: sent.data.messages_id },
      }),
      1,
    );
    receiver.disconnect();
  });
  test("migration backfills mixed legacy sequences precisely and never rewinds an advanced counter", async () => {
    const group = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Mixed legacy sequence",
    );
    const table = (name) =>
      database
        .getQueryInterface()
        .queryGenerator.quoteTable({ schema, tableName: name });
    const high = "9007199254740995"; // Larger than JavaScript's safe integer range.
    const old = await Message.create({
      chat_id: group.chats_id,
      sender_id: alice.user_id,
      content: "Existing sequence",
      message_sequence: high,
    });
    await database.query(
      `ALTER TABLE ${table("messages")} ALTER COLUMN message_sequence DROP NOT NULL`,
    );
    const missing = await Message.create({
      chat_id: group.chats_id,
      sender_id: alice.user_id,
      content: "Legacy NULL sequence",
      message_sequence: null,
    });
    await database.query(
      `ALTER SEQUENCE ${table("chat_message_sequence")} RESTART WITH 1`,
    );
    const migrate = require("../utils/chatMigration").migrateChatStorage;
    await migrate();
    assert.equal((await old.reload()).message_sequence, high);
    assert.ok(BigInt((await missing.reload()).message_sequence) > BigInt(high));
    const ahead = BigInt(missing.message_sequence) + 100n;
    await database.query(
      `ALTER SEQUENCE ${table("chat_message_sequence")} RESTART WITH ${ahead}`,
    );
    await migrate();
    const next = await chat.sendMessage(
      group.chats_id,
      alice.user_id,
      "Keep the counter ahead",
    );
    assert.equal(BigInt(next.message_sequence), ahead);
    await migrate();
    const afterRestart = await chat.sendMessage(
      group.chats_id,
      alice.user_id,
      "Repeat migration safely",
    );
    assert.equal(BigInt(afterRestart.message_sequence), ahead + 1n);
  });
  test("sequence recovery respects clear and unread watermarks above every stored message", async () => {
    const group = await chat.createChat(
      [bob.user_id],
      alice.user_id,
      "group",
      "Watermark recovery",
    );
    const table = (name) =>
      database
        .getQueryInterface()
        .queryGenerator.quoteTable({ schema, tableName: name });
    const baseline = "9007199254749999";
    const cleared = (BigInt(baseline) - 2n).toString();
    await ChatUserState.create({
      chat_id: group.chats_id,
      user_id: bob.user_id,
      cleared_through_sequence: cleared,
      unread_since_sequence: baseline,
    });
    await database.query(
      `ALTER SEQUENCE ${table("chat_message_sequence")} RESTART WITH 1`,
    );
    await require("../utils/chatMigration").migrateChatStorage();
    const message = await chat.sendMessage(
      group.chats_id,
      alice.user_id,
      "Visible after sequence repair",
    );
    assert.ok(BigInt(message.message_sequence) > BigInt(baseline));
    assert.equal(
      (await chat.getChatMessages(group.chats_id, bob.user_id)).messages[0]
        .messages_id,
      message.messages_id,
    );
    assert.equal(
      (await chat.getChatDetails(group.chats_id, bob.user_id)).unread_count,
      1,
    );
    const state = await ChatUserState.findOne({
      where: { chat_id: group.chats_id, user_id: bob.user_id },
    });
    assert.equal(state.cleared_through_sequence, cleared);
    assert.equal(state.unread_since_sequence, baseline);
  });
  test("deleting history before a member's clear or join baseline does not reduce new unread counts", async () => {
    const pm = await makeUser("project_manager"),
      staff = await makeUser("staff"),
      talent = await makeUser("talent");
    const group = await chat.createChat(
      [staff.user_id],
      pm.user_id,
      "group",
      "Unread boundary",
    );
    const old = await chat.sendMessage(
      group.chats_id,
      pm.user_id,
      "Old unread history",
    );
    await management.clearHistory(group.chats_id, staff.user_id);
    await management.addMembers(group.chats_id, pm.user_id, [talent.user_id]);
    await chat.sendMessage(group.chats_id, pm.user_id, "New unread message");
    await chat.deleteMessage(old.messages_id, pm.user_id);
    assert.equal(
      (await chat.getChatDetails(group.chats_id, staff.user_id)).unread_count,
      1,
    );
    assert.equal(
      (await chat.getChatDetails(group.chats_id, talent.user_id))
        .unread_count,
      1,
    );
  });
}
