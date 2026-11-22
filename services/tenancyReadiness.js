const { migrateTenancy } = require('./tenancyMigration');

// A deployment must apply and verify tenancy explicitly before serving HR data.
// Verification uses a dedicated pooled connection and never changes search_path.
async function assertTenancyReady(sequelize) {
  const schema = sequelize.options.schema || sequelize.schema;
  if (!schema) throw new Error('DB_SCHEMA is required for tenancy readiness');
  const client = await sequelize.connectionManager.getConnection({ type: 'WRITE' });
  try {
    const checkpoint = await client.query('SELECT to_regclass($1) present', [`${schema}.tenancy_migration_state`]);
    if (!checkpoint.rows[0].present) throw new Error('Apply the explicit tenancy migration before starting the application');
    const report = await migrateTenancy(client, { schema, mode: 'verify' });
    if (!report.ok) throw new Error(`Tenancy verification failed: ${report.errors.join('; ')}`);
    return report;
  } finally { await sequelize.connectionManager.releaseConnection(client); }
}

async function assertApplicationReady(sequelize) {
  // Release tenancy's dedicated connection before checking session models; this
  // also works with a single-connection pool in serverless deployments.
  const tenancy = await assertTenancyReady(sequelize);
  const sessions = await require('./authSessions').assertSessionStorageReady();
  return { tenancy, sessions };
}
module.exports = { assertTenancyReady, assertApplicationReady };
