const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const url = process.env.PLATFORM_TEST_DATABASE_URL;
if (!url) test('platform administration (set PLATFORM_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `platform_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const databasePath = require.resolve('../config/database');
  require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
  process.env.JWT_SECRET = randomUUID(); process.env.JWT_REFRESH_SECRET = randomUUID();
  process.env.PLATFORM_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 12).toString('base64');
  const models = require('../models');
  let server, origin, user, token;
  before(async () => {
    await db.createSchema(schema); await db.sync();
    await require('../migrations/20261122100000-managed-auth-sessions').up(db.getQueryInterface(), Sequelize);
    await require('../migrations/20261122110000-explicit-platform-authority').up(db.getQueryInterface(), Sequelize);
    const role = await models.Role.create({ role_key: 'super_admin', name: 'HR super admin' });
    user = await models.User.create({ email: 'hr-admin@example.test', role_id: role.role_id, is_verified: true });
    token = (await require('../services/authSessions').createSession(user)).token;
    const app = require('express')(); app.use(require('express').json());
    app.use('/api/platform', require('../routes/platformRoutes'));
    server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.dropSchema(schema, { cascade: true }); await db.close();
  });
  test('an HR super admin has no implicit platform authority', async () => {
    const response = await fetch(origin + '/api/platform/me', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'PLATFORM_ACCESS_DENIED');
  });
}
