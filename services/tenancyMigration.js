const { randomUUID, createHash } = require('node:crypto');
const { TENANT_TABLES, GLOBAL_SECURITY_TABLES, PROFILE_FIELDS, STECHAD_ORGANIZATION_ID } = require('./tenancyInventory');
const qi = (value) => `"${String(value).replaceAll('"', '""')}"`;
const constraintName = (...parts) => `tenant_${createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 24)}`;

async function migrateTenancy(client, { schema, mode }) {
  if (!schema || !['dry-run', 'apply', 'verify'].includes(mode)) throw new Error('Explicit schema and mode are required');
  const table = (name) => `${qi(schema)}.${qi(name)}`;
  const run = (sql, values = []) => client.query(sql, values);
  await run('BEGIN');
  try {
    if (mode !== 'apply') await run('SET TRANSACTION READ ONLY');
    else await run('SELECT pg_advisory_xact_lock(hashtext($1))', [`stechad-tenancy:${schema}`]);
    const { rows: tables } = await run('SELECT tablename FROM pg_tables WHERE schemaname = $1', [schema]);
    const existing = new Set(tables.map((row) => row.tablename));
    const known = new Set(['users', 'organizations', 'organization_memberships', 'hr_profiles', 'identity_audit_logs', 'SequelizeMeta', 'tenancy_migration_state', ...GLOBAL_SECURITY_TABLES, ...TENANT_TABLES]);
    const unclassifiedTables = [...existing].filter((name) => !known.has(name));
    if (!existing.has('users') || !existing.has('roles')) throw new Error('Legacy users and roles tables must exist; run existing migrations first');
    if (existing.has('tenancy_migration_state') && !(await run(`SELECT 1 FROM ${table('tenancy_migration_state')} WHERE migration_key='phase1-stechad'`)).rowCount) throw new Error('Tenancy migration checkpoint is missing; refusing to infer legacy users');
    const owned = TENANT_TABLES.filter((name) => existing.has(name));
    const inventory = {};
    for (const name of ['users', ...TENANT_TABLES]) inventory[name] = existing.has(name) ? Number((await run(`SELECT count(*) n FROM ${table(name)}`)).rows[0].n) : null;
    const missingTables = TENANT_TABLES.filter((name) => !existing.has(name));
    const report = { mode, ok: true, organizationId: STECHAD_ORGANIZATION_ID, inventory, missingTables, unclassifiedTables, unresolvedRelationships: [], crossTenantRelationships: [] };
    const columns = (name) => run(`SELECT a.attname name, format_type(a.atttypid,a.atttypmod) type, a.attnotnull required, pg_get_expr(d.adbin,d.adrelid) default_value FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname=$1 AND c.relname=$2 AND a.attnum>0 AND NOT a.attisdropped`, [schema, name]).then((r) => r.rows);
    const originalColumns = {};
    for (const name of owned) originalColumns[name] = await columns(name);
    if (mode === 'dry-run') {
      report.ok = !unclassifiedTables.length;
      await run('COMMIT'); return report;
    }
    if (unclassifiedTables.length) throw new Error(`Unclassified tables require ownership review: ${unclassifiedTables.join(', ')}`);
    const addConstraint = async (name, key, clause) => {
      const found = await run('SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=$2 AND c.conname=$3', [schema, name, key]);
      if (!found.rowCount) await run(`ALTER TABLE ${table(name)} ADD CONSTRAINT ${qi(key)} ${clause}`);
    };
    if (mode === 'apply') {
      // Snapshot legacy rows inside the same transaction to detect accidental rewriting.
      const fingerprint = async (name) => (await run(`SELECT md5(coalesce(string_agg(md5((to_jsonb(t) - 'organization_id')::text), '' ORDER BY md5((to_jsonb(t) - 'organization_id')::text)),'')) hash FROM ${table(name)} t`)).rows[0].hash;
      const before = {};
      for (const name of ['users', ...owned]) before[name] = await fingerprint(name);
      await run(`CREATE TABLE IF NOT EXISTS ${table('tenancy_migration_state')} (migration_key text PRIMARY KEY, legacy_user_ids jsonb NOT NULL CHECK (jsonb_typeof(legacy_user_ids)='array'), completed_at timestamptz NOT NULL DEFAULT now())`);
      await run(`INSERT INTO ${table('tenancy_migration_state')} (migration_key,legacy_user_ids) SELECT 'phase1-stechad',coalesce(jsonb_agg(user_id),'[]') FROM ${table('users')} ON CONFLICT (migration_key) DO NOTHING`);
      await run(`CREATE TABLE IF NOT EXISTS ${table('organizations')} (organization_id uuid PRIMARY KEY, slug varchar(100) NOT NULL UNIQUE, name varchar(200) NOT NULL, status varchar(20) NOT NULL DEFAULT 'active', settings jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
      await run(`INSERT INTO ${table('organizations')} (organization_id,slug,name) VALUES ($1,'stechad','Stechad') ON CONFLICT (organization_id) DO NOTHING`, [STECHAD_ORGANIZATION_ID]);
      const bootstrap = await run(`SELECT organization_id FROM ${table('organizations')} WHERE slug='stechad'`);
      if (bootstrap.rows[0]?.organization_id !== STECHAD_ORGANIZATION_ID) throw new Error('Existing stechad organization has a conflicting identifier');
      await addConstraint('organizations', 'organizations_status_valid', "CHECK (status IN ('active','suspended','archived'))");
      for (const name of owned) {
        if (existing.has('tenancy_migration_state')) {
          const ownership = originalColumns[name].find((column) => column.name === 'organization_id');
          if (!ownership || Number((await run(`SELECT count(*) n FROM ${table(name)} WHERE organization_id IS NULL`)).rows[0].n)) throw new Error(`New unowned data after tenancy cutover: ${name}`);
        }
        await run(`ALTER TABLE ${table(name)} ADD COLUMN IF NOT EXISTS organization_id uuid`);
        await run(`UPDATE ${table(name)} SET organization_id=$1 WHERE organization_id IS NULL`, [STECHAD_ORGANIZATION_ID]);
        await run(`ALTER TABLE ${table(name)} ALTER COLUMN organization_id SET NOT NULL`);
        await run(`CREATE INDEX IF NOT EXISTS ${qi(constraintName(name, 'organization'))} ON ${table(name)} (organization_id)`);
        await addConstraint(name, constraintName(name, 'organization_fk'), `FOREIGN KEY (organization_id) REFERENCES ${table('organizations')}(organization_id) ON DELETE RESTRICT`);
      }
      await run(`CREATE TABLE IF NOT EXISTS ${table('organization_memberships')} (membership_id uuid PRIMARY KEY, organization_id uuid NOT NULL, user_id uuid NOT NULL, membership_role varchar(20) NOT NULL DEFAULT 'member', status varchar(20) NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
      await run(`CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_org_user ON ${table('organization_memberships')} (organization_id,user_id)`);
      await run(`CREATE UNIQUE INDEX IF NOT EXISTS organization_memberships_org_member_user ON ${table('organization_memberships')} (organization_id,membership_id,user_id)`);
      await run(`CREATE INDEX IF NOT EXISTS organization_memberships_user_status ON ${table('organization_memberships')} (user_id,status)`);
      await addConstraint('organization_memberships', 'memberships_org_fk', `FOREIGN KEY (organization_id) REFERENCES ${table('organizations')}(organization_id) ON DELETE RESTRICT`);
      await addConstraint('organization_memberships', 'memberships_user_fk', `FOREIGN KEY (user_id) REFERENCES ${table('users')}(user_id) ON DELETE RESTRICT`);
      await addConstraint('organization_memberships', 'memberships_status_valid', "CHECK (status IN ('active','suspended','removed'))");
      await addConstraint('organization_memberships', 'memberships_role_valid', "CHECK (membership_role IN ('owner','admin','member'))");
      const userColumns = await columns('users');
      const availableFields = PROFILE_FIELDS.filter((field) => userColumns.some((column) => column.name === field));
      const profileFields = availableFields.map((field) => {
        const column = userColumns.find((c) => c.name === field);
        return `${qi(field)} ${column.type}${column.default_value ? ` DEFAULT ${column.default_value}` : ''}${column.required ? ' NOT NULL' : ''}`;
      });
      await run(`CREATE TABLE IF NOT EXISTS ${table('hr_profiles')} (hr_profile_id uuid PRIMARY KEY, organization_id uuid NOT NULL, membership_id uuid NOT NULL UNIQUE, user_id uuid NOT NULL, ${profileFields.join(',')}, archived_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
      await run(`CREATE UNIQUE INDEX IF NOT EXISTS hr_profiles_org_user ON ${table('hr_profiles')} (organization_id,user_id)`);
      await run(`CREATE UNIQUE INDEX IF NOT EXISTS hr_profiles_org_employee ON ${table('hr_profiles')} (organization_id,employee_id)`);
      await addConstraint('hr_profiles', 'profiles_membership_org_user_fk', `FOREIGN KEY (organization_id,membership_id,user_id) REFERENCES ${table('organization_memberships')}(organization_id,membership_id,user_id) ON DELETE RESTRICT`);
      const users = await run(`SELECT u.user_id, u.is_active, u.deleted_at, r.role_key FROM ${table('users')} u LEFT JOIN ${table('roles')} r ON r.role_id=u.role_id WHERE u.user_id::text IN (SELECT jsonb_array_elements_text(legacy_user_ids) FROM ${table('tenancy_migration_state')} WHERE migration_key='phase1-stechad')`);
      for (const user of users.rows) {
        const status = user.deleted_at ? 'removed' : user.is_active === false ? 'suspended' : 'active';
        const role = user.role_key === 'super_admin' ? 'owner' : user.role_key === 'admin' ? 'admin' : 'member';
        await run(`INSERT INTO ${table('organization_memberships')} (membership_id,organization_id,user_id,membership_role,status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (organization_id,user_id) DO NOTHING`, [randomUUID(), STECHAD_ORGANIZATION_ID, user.user_id, role, status]);
        await run(`INSERT INTO ${table('hr_profiles')} (hr_profile_id,organization_id,membership_id,user_id,${availableFields.map(qi).join(',')},created_at,updated_at) SELECT $1,m.organization_id,m.membership_id,u.user_id,${availableFields.map((f) => `u.${qi(f)}`).join(',')},u.created_at,u.updated_at FROM ${table('users')} u JOIN ${table('organization_memberships')} m ON m.user_id=u.user_id AND m.organization_id=$2 WHERE u.user_id=$3 ON CONFLICT (organization_id,user_id) DO NOTHING`, [randomUUID(), STECHAD_ORGANIZATION_ID, user.user_id]);
      }
      // Replace only tenant-owned non-primary unique constraints/indexes. UUID PKs stay global.
      for (const name of owned) {
        const indexes = await run(`SELECT ic.relname index_name, co.conname, pg_get_expr(i.indpred,i.indrelid) predicate, array_agg(pg_get_indexdef(i.indexrelid,k.ordinality::int,true) ORDER BY k.ordinality) terms, coalesce(array_agg(a.attname::text) FILTER (WHERE a.attname IS NOT NULL),'{}') fields FROM pg_index i JOIN pg_class tc ON tc.oid=i.indrelid JOIN pg_namespace n ON n.oid=tc.relnamespace JOIN pg_class ic ON ic.oid=i.indexrelid CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality) LEFT JOIN pg_attribute a ON a.attrelid=tc.oid AND a.attnum=k.attnum LEFT JOIN pg_constraint co ON co.conindid=i.indexrelid WHERE n.nspname=$1 AND tc.relname=$2 AND i.indisunique AND NOT i.indisprimary GROUP BY ic.relname,i.indexrelid,co.conname,i.indpred,i.indrelid`, [schema, name]);
        for (const index of indexes.rows) {
          if (index.fields.includes('organization_id')) continue;
          // Keep expression terms and partial predicates (legacy lower-case role uniqueness included).
          await run(`CREATE UNIQUE INDEX IF NOT EXISTS ${qi(constraintName(name, ...index.terms, index.predicate || '', 'unique'))} ON ${table(name)} (organization_id,${index.terms.join(',')})${index.predicate ? ` WHERE ${index.predicate}` : ''}`);
          if (index.conname) await run(`ALTER TABLE ${table(name)} DROP CONSTRAINT ${qi(index.conname)}`);
          else await run(`DROP INDEX ${qi(schema)}.${qi(index.index_name)}`);
        }
      }
      // Unique composite parent keys allow FKs to prove organization equality.
      for (const name of [...owned, 'hr_profiles']) {
        const pk = (await run(`SELECT a.attname FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=ANY(i.indkey) WHERE n.nspname=$1 AND c.relname=$2 AND i.indisprimary ORDER BY a.attnum`, [schema, name])).rows.map((row) => row.attname);
        if (pk.length === 1) await run(`CREATE UNIQUE INDEX IF NOT EXISTS ${qi(constraintName(name, 'org_pk'))} ON ${table(name)} (organization_id,${qi(pk[0])})`);
      }
      for (const name of ['users', ...owned]) if (before[name] !== await fingerprint(name)) throw new Error(`Legacy row preservation check failed: ${name}`);
    }
    // Install/verify all known relationship boundaries, keeping orphaned history intact.
    const errors = [];
    const relations = (await run(`SELECT c.conname, s.relname child, a.attname child_column, p.relname parent, pa.attname parent_column FROM pg_constraint c JOIN pg_class s ON s.oid=c.conrelid JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_class p ON p.oid=c.confrelid JOIN pg_attribute a ON a.attrelid=s.oid AND a.attnum=c.conkey[1] JOIN pg_attribute pa ON pa.attrelid=p.oid AND pa.attnum=c.confkey[1] WHERE n.nspname=$1 AND c.contype='f' AND array_length(c.conkey,1)=1`, [schema])).rows.filter((r) => owned.includes(r.child) && (owned.includes(r.parent) || r.parent === 'users'));
    // Some legacy logical relationships deliberately had no FK.
    const logical = [
      ['stored_files','owner_user_id','users','user_id'],
      ['hr_profiles','role_id','roles','role_id'], ['hr_profiles','department_id','departments','department_id'], ['hr_profiles','reports_to_user_id','users','user_id'],
      ['departments','manager_user_id','users','user_id'], ['audit_logs','actor_user_id','users','user_id'],
      ['notification_broadcasts','created_by','users','user_id'], ['invites','invited_by_user_id','users','user_id'],
      ['invites','department_id','departments','department_id'], ['projects','created_by_user_id','users','user_id'],
      ['chats','created_by','users','user_id'], ['chats','last_message_sender_id','users','user_id'], ['chats','last_message_id','messages','messages_id'],
      ['notifications','broadcast_id','notification_broadcasts','broadcast_id'], ['hr_profiles','deleted_by_user_id','users','user_id'],
    ];
    for (const [child, child_column, parent, parent_column] of logical) {
      if ((existing.has(child) || child === 'hr_profiles') && (await columns(child)).some((c) => c.name === child_column)) relations.push({ child, child_column, parent, parent_column });
    }
    const seen = new Set();
    for (const relation of relations) {
      const { child, child_column, parent, parent_column } = relation;
      const key = `${child}:${child_column}:${parent}`; if (seen.has(key)) continue; seen.add(key);
      const referencedTable = parent === 'users' ? 'organization_memberships' : parent;
      const name = constraintName(key, 'same_org');
      const orphanCount = Number((await run(`SELECT count(*) n FROM ${table(child)} c WHERE c.${qi(child_column)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${table(referencedTable)} p WHERE p.organization_id=c.organization_id AND p.${qi(parent_column)}=c.${qi(child_column)})`)).rows[0].n);
      const crossTenantCount = Number((await run(`SELECT count(*) n FROM ${table(child)} c WHERE c.${qi(child_column)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${table(referencedTable)} p WHERE p.organization_id=c.organization_id AND p.${qi(parent_column)}=c.${qi(child_column)}) AND EXISTS (SELECT 1 FROM ${table(referencedTable)} p WHERE p.${qi(parent_column)}=c.${qi(child_column)})`)).rows[0].n);
      if (crossTenantCount) { report.crossTenantRelationships.push({ child, column: child_column, parent, count: crossTenantCount }); errors.push(`${child}.${child_column}: ${crossTenantCount} cross-organization references`); }
      if (orphanCount) report.unresolvedRelationships.push({ child, column: child_column, parent, count: orphanCount });
      if (mode === 'apply') {
        await run(`CREATE INDEX IF NOT EXISTS ${qi(constraintName(child, child_column, 'fk_index'))} ON ${table(child)} (organization_id,${qi(child_column)})`);
        await addConstraint(child, name, `FOREIGN KEY (organization_id,${qi(child_column)}) REFERENCES ${table(referencedTable)} (organization_id,${qi(parent_column)}) NOT VALID`);
        if (!orphanCount) await run(`ALTER TABLE ${table(child)} VALIDATE CONSTRAINT ${qi(name)}`);
      } else {
        const constraint = await run('SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname=$1 AND t.relname=$2 AND c.conname=$3', [schema, child, name]);
        if (!constraint.rowCount) errors.push(`${child}.${child_column}: missing same-organization constraint`);
      }
    }
    for (const name of owned) {
      if (!(await columns(name)).some((column) => column.name === 'organization_id' && column.required)) { errors.push(`${name}: missing ownership column`); continue; }
      if (Number((await run(`SELECT count(*) n FROM ${table(name)} t WHERE organization_id IS NULL OR NOT EXISTS (SELECT 1 FROM ${table('organizations')} o WHERE o.organization_id=t.organization_id)`)).rows[0].n)) errors.push(`${name}: missing organization`);
    }
    const unmapped = await run(`SELECT u.user_id FROM ${table('users')} u WHERE u.user_id::text IN (SELECT jsonb_array_elements_text(legacy_user_ids) FROM ${table('tenancy_migration_state')} WHERE migration_key='phase1-stechad') AND NOT EXISTS (SELECT 1 FROM ${table('organization_memberships')} m JOIN ${table('hr_profiles')} p ON p.membership_id=m.membership_id AND p.organization_id=m.organization_id AND p.user_id=m.user_id WHERE m.user_id=u.user_id AND m.organization_id=$1)`, [STECHAD_ORGANIZATION_ID]);
    if (unmapped.rowCount) errors.push(`${unmapped.rowCount} legacy users lack stechad membership/profile`);
    report.errors = errors; report.ok = !errors.length;
    if (mode === 'apply' && !report.ok) throw new Error(errors.join('; '));
    await run('COMMIT'); return report;
  } catch (error) { await run('ROLLBACK'); throw error; }
}
module.exports = { migrateTenancy };
