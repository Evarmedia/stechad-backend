const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const url = process.env.MEMBERSHIP_TEST_DATABASE_URL;
if (!url) test('organization invitation migration command (set MEMBERSHIP_TEST_DATABASE_URL)', { skip: true }, () => {});
else test('versioned invitation migration preserves pending legacy bearers and supports repeated CLI runs', async () => {
  const { Client } = require('pg');
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const { execFile } = require('node:child_process');
  const execute = require('node:util').promisify(execFile);
  const schema = `invite_migration_${randomUUID().replaceAll('-', '')}`;
  const temporary = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'stechad-invite-migration-'));
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA "${schema}"`);
    await db.query(`CREATE TABLE "${schema}".invites (invite_id text PRIMARY KEY, token text, status text)`);
    await db.query(`INSERT INTO "${schema}".invites VALUES ('legacy-invite', 'legacy-emailed-bearer', 'pending')`);
    const migrations = path.join(temporary, 'migrations'); await fs.mkdir(migrations);
    await fs.copyFile(path.join(__dirname, '../migrations/20261121120000-organization-invitations.js'), path.join(migrations, '20261121120000-organization-invitations.js'));
    const configuration = path.join(temporary, 'config.js');
    await fs.writeFile(configuration, `module.exports = { test: { use_env_variable: 'MEMBERSHIP_TEST_DATABASE_URL', dialect: 'postgres', schema: '${schema}', migrationStorageTableSchema: '${schema}', logging: false } };`);
    const run = () => execute(process.execPath, [require.resolve('sequelize-cli/lib/sequelize'), 'db:migrate', '--env', 'test', '--config', configuration, '--migrations-path', migrations], { env: { ...process.env, MEMBERSHIP_TEST_DATABASE_URL: url } });
    assert.match((await run()).stdout, /organization-invitations: migrated/);
    assert.match((await run()).stdout, /No migrations were executed/);
    const row = (await db.query(`SELECT token, status, token_hash, membership_role FROM "${schema}".invites WHERE invite_id = 'legacy-invite'`)).rows[0];
    assert.deepEqual(row, { token: 'legacy-emailed-bearer', status: 'pending', token_hash: null, membership_role: 'member' });
  } finally {
    await db.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await db.end(); await fs.rm(temporary, { recursive: true, force: true });
  }
});
