#!/usr/bin/env node
const { Client } = require('pg');
const { migrateTenancy } = require('../services/tenancyMigration');
async function main() {
  const args = process.argv.slice(2);
  const option = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
  const modes = ['dry-run', 'apply', 'verify'].filter((mode) => args.includes(`--${mode}`));
  if (modes.length !== 1) throw new Error('Choose exactly one mode: --dry-run, --apply, --verify');
  const schema = option('--schema') || process.env.DB_SCHEMA;
  const connectionString = option('--database-url') || process.env.DATABASE_URL;
  if (!schema || !connectionString) throw new Error('Explicit --schema/DB_SCHEMA and --database-url/DATABASE_URL are required');
  const client = new Client({ connectionString });
  try { await client.connect(); const report = await migrateTenancy(client, { schema, mode: modes[0] }); console.log(JSON.stringify(report)); if (!report.ok) process.exitCode = 1; }
  finally { await client.end(); }
}
if (require.main === module) main().catch((error) => { console.error(`Tenancy migration failed: ${error.message}`); process.exitCode = 1; });
