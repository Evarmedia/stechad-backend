const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { execFile } = require('node:child_process');
const execute = require('node:util').promisify(execFile);
const url = process.env.SESSIONS_TEST_DATABASE_URL;
if (!url) test('application session readiness (set SESSIONS_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize } = require('sequelize');
  const schema = `app_readiness_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false, pool: { max: 1, min: 0 } }); db.schema = schema;
  db.afterDefine(model => { model.options.schema = schema; });
  const database = require.resolve('../config/database');
  require.cache[database] = { id: database, filename: database, loaded: true, exports: db };
  process.env.VERCEL = '1';
  process.env.GOOGLE_CLIENT_ID = 'readiness-client'; process.env.GOOGLE_CLIENT_SECRET = 'readiness-secret';
  process.env.JWT_SECRET = 'readiness-access'; process.env.JWT_REFRESH_SECRET = 'readiness-refresh';
  const models = require('../models');
  let server, origin;
  before(async () => {
    await db.createSchema(schema); await db.sync();
    for (const table of ['hr_profiles', 'organization_memberships', 'organizations']) await db.query(`DROP TABLE "${schema}"."${table}" CASCADE`);
    await execute(process.execPath, ['scripts/migrate-tenancy.js', '--apply', '--database-url', url, '--schema', schema], { cwd: require('node:path').resolve(__dirname, '..') });
    server = require('../server'); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise(resolve => require('../utils/events').getRealtime().close(resolve));
    try { await db.dropSchema(schema, { cascade: true }); } finally { await db.close(); }
  });
  test('serverless requests refuse unactivated session storage and recover after migration without extending activation', async () => {
    const health = () => fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(8000) });
    assert.equal((await health()).status, 503);
    await require('../migrations/20261122100000-managed-auth-sessions').up(db.getQueryInterface(), Sequelize);
    const first = await models.AuthSecurityState.findByPk('sessions');
    assert.equal((await health()).status, 200);
    await require('../migrations/20261122100000-managed-auth-sessions').up(db.getQueryInterface(), Sequelize);
    const repeated = await models.AuthSecurityState.findByPk('sessions');
    assert.equal(new Date(repeated.activated_at).getTime(), new Date(first.activated_at).getTime());
    assert.equal(new Date(repeated.legacy_until).getTime(), new Date(first.legacy_until).getTime());
    assert.equal((await health()).status, 200);
  });
}
