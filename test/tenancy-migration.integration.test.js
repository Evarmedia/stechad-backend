const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const url = process.env.TENANCY_TEST_DATABASE_URL;
if (!url) test('tenancy migration command (set TENANCY_TEST_DATABASE_URL)', { skip: true }, () => {});
else {
  const { Sequelize, QueryTypes } = require('sequelize');
  const schema = `tenant_migration_${randomUUID().replaceAll('-', '')}`;
  const db = new Sequelize(url, { schema, logging: false }); db.schema = schema;
  db.afterDefine((model) => { model.options.schema = schema; });
  const path = require.resolve('../config/database'); require.cache[path] = { id: path, filename: path, loaded: true, exports: db };
  const models = require('../models');
  const command = async (mode) => JSON.parse((await promisify(execFile)(process.execPath, ['scripts/migrate-tenancy.js', `--${mode}`, '--database-url', url, '--schema', schema], { cwd: require('node:path').resolve(__dirname, '..') })).stdout);
  let userId, roleId, password, departmentId, orphanId, invoiceId, chatId;
  before(async () => {
    await db.createSchema(schema); await db.sync();
    for (const name of ['hr_profiles','organization_memberships','organizations']) await db.query(`DROP TABLE "${schema}"."${name}" CASCADE`);
    const role = await models.Role.create({ role_key: 'finance', name: 'Finance', permission_keys: ['approve_invoices'] }); roleId = role.role_id;
    const user = await models.User.create({ email: 'old@example.test', password: 'Preserved-secret-123', role_id: roleId, employee_id: 'OLD-1', workforce_permissions: ['create_projects'], avatar_object_name: 'private/old.png' });
    userId = user.user_id;
    password = (await models.User.unscoped().findByPk(userId)).password;
    await user.destroy();
    departmentId = (await models.Department.create({ name: 'Finance', code: 'FIN' })).department_id;
    await models.RolePermission.create({ permission_key: 'approve_invoices', name: 'Invoices', admin: false, staff: true });
    await models.Setting.create({ key: 'custom-retained', value: 'retained' });
    // Exercise historical financial, file, pending-invite and personal-chat data.
    invoiceId = (await models.Invoice.create({ invoice_number: 'LEGACY-001', invoice_type: 'staff', period: 'October 2026', amount: 123.45, status: 'paid', submitted_by: null, zoho_invoice_id: 'external-keep' })).invoice_id;
    await models.ExpenseClaim.create({ user_id: null, category: 'Travel', amount: 51.25, expense_date: '2026-10-01', receipt_object_name: 'receipts/keep.pdf', status: 'paid' });
    await models.Invite.create({ email: 'invited@example.test', role_id: roleId, sent_at: '2026-11-01', expires_at: '2026-12-01', token: 'pending-token-keep' });
    const chat = await models.Chat.create({ chat_type: 'direct', participants: [userId] }); chatId = chat.chats_id;
    await db.models.ChatParticipants.create({ chat_id: chatId, user_id: userId });
    await models.ChatUserState.create({ chat_id: chatId, user_id: userId, cleared_through_sequence: 9, hidden_through_sequence: 12 });
    await models.Message.create({ chat_id: chatId, sender_id: null, content: 'Historical attachment', attachments: [{ object_name: 'chat/keep.pdf' }] });
    orphanId = randomUUID();
    await db.query(`CREATE UNIQUE INDEX legacy_roles_lower ON "${schema}".roles (lower(name))`);
    // A retained historical actor need not have a live identity.
    await models.AuditLog.create({ audit_log_id: randomUUID(), action: 'historical', actor_user_id: orphanId, target_type: 'user', target_id: userId, changes: { file: 'old/receipt.pdf' } });
  });
  after(async () => { await db.dropSchema(schema, { cascade: true }); await db.close(); });
  test('dry-run is read-only; apply twice and verify preserve identifiers, credentials, grants and deleted history', async () => {
    await assert.rejects(require('../services/tenancyReadiness').assertTenancyReady(db), /Apply the explicit tenancy migration/);
    const dry = await command('dry-run'); assert.equal(dry.mode, 'dry-run'); assert.equal(dry.inventory.users, 1);
    assert.equal(await db.getQueryInterface().tableExists({ tableName: 'organizations', schema }), false);
    assert.equal((await command('apply')).ok, true);
    await db.query(`UPDATE "${schema}".hr_profiles SET job_title = 'Changed after migration' WHERE user_id = :id`, { replacements: { id: userId } });
    assert.equal((await command('apply')).ok, true);
    assert.equal((await require('../services/tenancyReadiness').assertTenancyReady(db)).ok, true);
    const report = await command('verify'); assert.equal(report.ok, true); assert.equal(report.inventory.ChatParticipants, 1); assert.equal(report.inventory.talent_project, 0);
    assert.ok(report.unresolvedRelationships.some((r) => r.child === 'audit_logs' && r.column === 'actor_user_id' && r.count === 1));
    const [user] = await db.query(`SELECT * FROM "${schema}".users`, { type: QueryTypes.SELECT });
    assert.equal(user.user_id, userId); assert.equal(user.password, password); assert.ok(user.deleted_at); assert.equal(user.avatar_object_name, 'private/old.png');
    const [profile] = await db.query(`SELECT * FROM "${schema}".hr_profiles`, { type: QueryTypes.SELECT });
    assert.equal(profile.role_id, roleId); assert.deepEqual(profile.workforce_permissions, ['create_projects']); assert.equal(profile.employee_id, 'OLD-1'); assert.equal(profile.job_title, 'Changed after migration');
    const [grant] = await db.query(`SELECT * FROM "${schema}".role_permissions`, { type: QueryTypes.SELECT }); assert.equal(grant.staff, true); assert.equal(grant.admin, false);
    assert.equal((await db.query(`SELECT count(*)::int n FROM "${schema}".organization_memberships`, { type: QueryTypes.SELECT }))[0].n, 1);
    const [department] = await db.query(`SELECT * FROM "${schema}".departments`, { type: QueryTypes.SELECT }); assert.equal(department.department_id, departmentId); assert.equal(department.organization_id, profile.organization_id);
    const [invoice] = await db.query(`SELECT * FROM "${schema}".invoices`, { type: QueryTypes.SELECT }); assert.equal(invoice.invoice_id, invoiceId); assert.equal(invoice.amount, '123.45'); assert.equal(invoice.zoho_invoice_id, 'external-keep'); assert.equal(invoice.submitted_by, null);
    const [chatState] = await db.query(`SELECT * FROM "${schema}".chat_user_states`, { type: QueryTypes.SELECT }); assert.equal(chatState.chat_id, chatId); assert.equal(chatState.hidden_through_sequence, '12');
    await assert.rejects(db.query(`INSERT INTO "${schema}".audit_logs (audit_log_id,organization_id,actor_user_id,action,target_type,occurred_at) VALUES (:id,:org,:orphan,'new','user',now())`, { replacements: { id: randomUUID(), org: profile.organization_id, orphan: orphanId } }), /foreign key/);
    // Same keys/names can coexist in a second organization, but cross-org role/profile links cannot.
    const otherOrg = randomUUID(), otherRole = randomUUID();
    await db.query(`INSERT INTO "${schema}".organizations (organization_id,slug,name) VALUES (:id,'second','Second')`, { replacements: { id: otherOrg } });
    await db.query(`INSERT INTO "${schema}".roles (role_id,organization_id,role_key,name) VALUES (:role,:org,'finance','Finance')`, { replacements: { role: otherRole, org: otherOrg } });
    const newUser = await models.User.create({ email: 'new-second@example.test', role_id: otherRole });
    const newMembership = await models.OrganizationMembership.create({ organization_id: otherOrg, user_id: newUser.user_id });
    await models.HRProfile.create({ organization_id: otherOrg, user_id: newUser.user_id, membership_id: newMembership.membership_id, role_id: otherRole });
    assert.equal((await command('apply')).ok, true);
    const otherMemberships = await models.OrganizationMembership.findAll({ where: { user_id: newUser.user_id } }); assert.equal(otherMemberships.length, 1); assert.equal(otherMemberships[0].organization_id, otherOrg);
    await require('../utils/roleMigration').migrateRoleStorage();
    assert.equal((await command('verify')).ok, true);
    await assert.rejects(db.query(`UPDATE "${schema}".hr_profiles SET role_id=:role WHERE user_id=:user`, { replacements: { role: otherRole, user: userId } }), /foreign key/);
    await assert.rejects(db.query(`UPDATE "${schema}".departments SET organization_id = :id`, { replacements: { id: randomUUID() } }), /foreign key/);
  });
}
