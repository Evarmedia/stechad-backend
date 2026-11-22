const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const url = process.env.SESSIONS_TEST_DATABASE_URL;
if (!url) test('managed session HTTP/PostgreSQL regressions', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `sessions_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { logging: false, schema }); db.schema = schema;
  db.afterDefine(model => { model.options.schema = schema; });
  const path = require.resolve('../config/database'); require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
  process.env.GOOGLE_CLIENT_ID = 'test-client'; process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.JWT_SECRET = 'test-access'; process.env.JWT_REFRESH_SECRET = 'test-refresh'; process.env.AUTH_SESSIONS_ENFORCED = 'true';
  const { User, Role } = require('../models');
  let server, origin, user;
  const request = async (path, body, token, method = 'POST') => {
    const res = await fetch(`${origin}/api/auth/${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, ...await res.json() };
  };
  const login = () => request('login', { email: user.email, password: 'password6' });
  before(async () => {
    await db.createSchema(schema); await db.sync();
    await require('../migrations/20261122100000-managed-auth-sessions').up(db.getQueryInterface(), Sequelize);
    const role = await Role.create({ role_key: 'staff', name: 'Staff', is_system: true });
    user = await User.create({ email: 'sessions@example.com', password: 'password6', role_id: role.role_id, is_verified: true });
    const app = require('express')(); app.use(require('express').json()); app.use('/api/auth', require('../routes/authRoutes'));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => { if (server) await new Promise(resolve => server.close(resolve)); try { await db.dropSchema(schema, { cascade: true }); } finally { await db.close(); } });
  test('sign in creates a revocable device session while preserving the global identity response', async () => {
    const signed = await login(); assert.equal(signed.status, 200); assert.equal(signed.data.user.user_id, user.user_id);
    assert.ok(signed.data.session.session_id);
    const listed = await request('sessions', undefined, signed.data.token, 'GET');
    assert.equal(listed.status, 200); assert.equal(listed.data.current_session_id, signed.data.session.session_id);
    assert.equal(listed.data.sessions.filter(s => s.current).length, 1);
    assert.equal(JSON.stringify(listed).includes('token_hash'), false);
    assert.equal((await request('logout', {}, signed.data.token)).status, 200);
    assert.equal((await request('me', undefined, signed.data.token, 'GET')).status, 401);
  });
}
