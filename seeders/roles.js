require("dotenv").config();

const sequelize = require("../config/database");
const { Role } = require("../models");

const SYSTEM_ROLES = Object.freeze([
  { role_key: "super_admin", name: "Super Admin", description: "Full HR administration access within this organization." },
  { role_key: "admin", name: "Admin", description: "HR and workforce administration access within this organization." },
  { role_key: "project_manager", name: "Project Manager", description: "Project, hiring, team, and delivery management access." },
  { role_key: "talent", name: "Talent", description: "Engineering talent profile and project delivery access." },
  { role_key: "staff", name: "Staff", description: "Workforce self-service access." },
]);

const seedSystemRoles = async ({ transaction, organizationId } = {}) => {
  // Legacy installs still bootstrap before the additive tenancy migration.
  // Once tenancy exists, only an explicit organization receives these HR roles.
  if (!organizationId) {
    const schema = sequelize.schema || sequelize.options.schema || 'public';
    const qi = sequelize.getQueryInterface();
    if (await qi.tableExists({ schema, tableName: 'organizations' }, { transaction })) {
      const [rows] = await sequelize.query(`SELECT organization_id FROM ${qi.queryGenerator.quoteTable({ schema, tableName: 'organizations' })} WHERE slug='stechad'`, { transaction });
      organizationId = rows[0]?.organization_id;
    }
  }
  const ownership = organizationId ? { organization_id: organizationId } : {};
  const roles = [];
  for (const definition of SYSTEM_ROLES) {
    const [role] = await Role.findOrCreate({
      where: { role_key: definition.role_key, ...ownership },
      defaults: { ...definition, ...ownership, is_system: true },
      transaction,
    });
    const canonical = { ...definition, is_system: true };
    const needsUpdate = Object.entries(canonical).some(([field, value]) => role[field] !== value);
    if (needsUpdate) await role.update(canonical, { transaction });
    roles.push(role);
  }
  return roles;
};

const run = async () => {
  await sequelize.authenticate();
  await Role.sync();
  const roles = await sequelize.transaction((transaction) => seedSystemRoles({ transaction }));
  console.log(`System roles ready: ${roles.map((role) => role.role_key).join(", ")}`);
};

if (require.main === module) {
  run()
    .catch((error) => {
      console.error(`Role seed failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(async () => sequelize.close());
}

module.exports = { SYSTEM_ROLES, seedSystemRoles };
