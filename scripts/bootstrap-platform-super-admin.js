#!/usr/bin/env node
// Deliberate global grant bootstrap; never creates an identity or changes HR roles.
const { Sequelize } = require('sequelize');
function argumentsFor(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') { options.apply = true; continue; }
    const key = { '--database-url': 'url', '--schema': 'schema', '--email': 'email', '--reason': 'reason' }[argv[i]];
    if (!key || !argv[i + 1] || argv[i + 1].startsWith('--') || options[key]) throw new Error('Use --database-url URL --schema NAME --email EMAIL --reason TEXT [--apply]');
    options[key] = argv[++i];
  }
  if (!options.url || !/^postgres(?:ql)?:\/\//.test(options.url) || !options.email || !options.reason?.trim() || options.reason.trim().length > 1000 || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(options.schema || '')) throw new Error('Explicit database URL, valid schema, existing email and audit reason are required');
  return options;
}
async function main(argv) {
  const options = argumentsFor(argv);
  const db = new Sequelize(options.url, { schema: options.schema, logging: false }); db.schema = options.schema;
  db.afterDefine((model) => { model.options.schema = options.schema; });
  const databasePath = require.resolve('../config/database');
  require.cache[databasePath] = { id: databasePath, filename: databasePath, loaded: true, exports: db };
  const { User, PlatformRole, PlatformRoleGrant } = require('../models');
  const { serialize, audit, fail } = require('../services/platformAuthorization');
  try {
    return await db.transaction(async (transaction) => {
      await serialize(transaction);
      const user = await User.unscoped().findOne({ where: { email: options.email.trim().toLowerCase() }, transaction, lock: transaction.LOCK.UPDATE });
      if (!user?.is_active || !user.is_verified || user.deleted_at) throw fail(400, 'BOOTSTRAP_TARGET_UNAVAILABLE', 'Bootstrap requires an existing active verified global identity');
      const role = await PlatformRole.findOne({ where: { role_key: 'platform_super_admin' }, transaction });
      if (!role) throw fail(503, 'PLATFORM_NOT_MIGRATED', 'Run the additive platform migration before bootstrap');
      const existing = await PlatformRoleGrant.findOne({ where: { user_id: user.user_id, role_id: role.role_id, status: 'active' }, transaction });
      const plan = { applied: Boolean(options.apply), already_granted: Boolean(existing), user_id: user.user_id, email: user.email, role_key: role.role_key };
      if (!options.apply) return plan;
      if (!existing) {
        const grant = await PlatformRoleGrant.create({ user_id: user.user_id, role_id: role.role_id, granted_by: user.user_id }, { transaction });
        await audit(user, 'platform.bootstrap.super_admin_granted', 'PlatformGrant', grant.grant_id, { user_id: user.user_id, role_key: role.role_key, reason: options.reason.trim() }, transaction);
      }
      return plan;
    });
  } finally { await db.close(); }
}
if (require.main === module) main(process.argv.slice(2)).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => { process.stderr.write(`${error.code || 'BOOTSTRAP_FAILED'}: ${error.status || !error.name?.startsWith('Sequelize') ? error.message : 'Bootstrap failed; verify the explicit database and migrated schema'}\n`); process.exitCode = 1; });
module.exports = { main };
