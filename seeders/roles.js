require("dotenv").config();

const sequelize = require("../config/database");
const Role = require("../models/Role");

const SYSTEM_ROLES = Object.freeze([
  { role_key: "super_admin", name: "Super Admin", description: "Full platform access, including system administration." },
  { role_key: "admin", name: "Admin", description: "Platform and workforce administration access." },
  { role_key: "project_manager", name: "Project Manager", description: "Project, hiring, team, and delivery management access." },
  { role_key: "engineer", name: "Engineer", description: "Engineering talent profile and project delivery access." },
  { role_key: "staff", name: "Staff", description: "Workforce self-service access." },
]);

const seedSystemRoles = async ({ transaction } = {}) => {
  const roles = [];
  for (const definition of SYSTEM_ROLES) {
    const [role] = await Role.findOrCreate({
      where: { role_key: definition.role_key },
      defaults: { ...definition, is_system: true },
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
