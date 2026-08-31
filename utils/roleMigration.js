const { DataTypes, QueryTypes } = require("sequelize");
const sequelize = require("../config/database");
const Role = require("../models/Role");
const { seedSystemRoles } = require("../seeders/roles");

const getSchema = () => sequelize.schema || sequelize.options.schema || "public";
const tableReference = (tableName) => ({ tableName, schema: getSchema() });
const quoteTable = (queryInterface, tableName) => queryInterface.queryGenerator.quoteTable(tableReference(tableName));

const normalizeTableName = (table) => typeof table === "string" ? table : table.tableName || table.name;

const tableExists = async (queryInterface, tableName, transaction) => {
  const tables = await queryInterface.showAllTables({ transaction, schema: getSchema() });
  return tables.map(normalizeTableName).includes(tableName);
};

const ensureRoleForeignKey = async ({ queryInterface, tableName, transaction }) => {
  const schema = getSchema();
  const constraints = await sequelize.query(
    `SELECT DISTINCT tc.constraint_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY'
       AND tc.table_schema = :schema
       AND tc.table_name = :tableName
       AND kcu.column_name = 'role_id'
       AND ccu.table_name = 'roles'
       AND ccu.column_name = 'role_id'`,
    { replacements: { schema, tableName }, transaction, type: QueryTypes.SELECT },
  );
  const expectedName = `${tableName}_role_id_fkey`;
  if (constraints.length === 1 && constraints[0].constraint_name === expectedName) return;

  for (const constraint of constraints) {
    await queryInterface.removeConstraint(tableReference(tableName), constraint.constraint_name, { transaction });
  }
  await queryInterface.addConstraint(tableReference(tableName), {
    fields: ["role_id"],
    type: "foreign key",
    name: expectedName,
    references: { table: tableReference("roles"), field: "role_id" },
    onUpdate: "CASCADE",
    onDelete: "RESTRICT",
    transaction,
  });
};

const migrateRoleColumn = async ({ queryInterface, tableName, transaction }) => {
  if (!(await tableExists(queryInterface, tableName, transaction))) return;
  const columns = await queryInterface.describeTable(tableReference(tableName), { transaction });

  if (!columns.role_id) {
    await queryInterface.addColumn(tableReference(tableName), "role_id", {
      type: DataTypes.UUID,
      allowNull: true,
    }, { transaction });
  }

  if (columns.role) {
    const targetTable = quoteTable(queryInterface, tableName);
    const rolesTable = quoteTable(queryInterface, "roles");
    await sequelize.query(
      `UPDATE ${targetTable} AS target
       SET "role_id" = roles."role_id"
       FROM ${rolesTable} AS roles
       WHERE target."role_id" IS NULL AND roles."role_key" = target."role"`,
      { transaction },
    );
  }

  const targetTable = quoteTable(queryInterface, tableName);
  const unresolved = await sequelize.query(
    `SELECT COUNT(*)::integer AS count FROM ${targetTable} WHERE "role_id" IS NULL`,
    { transaction, type: QueryTypes.SELECT },
  );
  if (Number(unresolved[0]?.count || 0) > 0) {
    const legacyValues = columns.role
      ? await sequelize.query(
        `SELECT DISTINCT "role" FROM ${targetTable} WHERE "role_id" IS NULL`,
        { transaction, type: QueryTypes.SELECT },
      )
      : [];
    throw new Error(`Cannot migrate ${tableName}: unresolved roles ${legacyValues.map((item) => item.role).join(", ") || "without a role_id"}`);
  }

  await queryInterface.changeColumn(tableReference(tableName), "role_id", {
    type: DataTypes.UUID,
    allowNull: false,
  }, { transaction });

  if (columns.role) await queryInterface.removeColumn(tableReference(tableName), "role", { transaction });
  await ensureRoleForeignKey({ queryInterface, tableName, transaction });
};

const migrateRoleStorage = async () => {
  const queryInterface = sequelize.getQueryInterface();
  await Role.sync();

  await sequelize.transaction(async (transaction) => {
    const roles = await seedSystemRoles({ transaction });
    const superAdminRole = roles.find((role) => role.role_key === "super_admin");
    const rolesTable = quoteTable(queryInterface, "roles");
    const usersTable = quoteTable(queryInterface, "users");
    const invitesTable = quoteTable(queryInterface, "invites");
    const singleSuperAdminIndex = queryInterface.queryGenerator.quoteTable(tableReference("users_single_super_admin"));

    if (sequelize.getDialect() === "postgres") {
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS "roles_role_key_lower_unique" ON ${rolesTable} (LOWER("role_key"))`, { transaction });
      await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_lower_unique" ON ${rolesTable} (LOWER("name"))`, { transaction });
    }

    await sequelize.query(`DROP INDEX IF EXISTS ${singleSuperAdminIndex}`, { transaction });
    await migrateRoleColumn({ queryInterface, tableName: "users", transaction });
    await migrateRoleColumn({ queryInterface, tableName: "invites", transaction });

    if (await tableExists(queryInterface, "users", transaction)) {
      await sequelize.query(`CREATE INDEX IF NOT EXISTS "users_role_id" ON ${usersTable} ("role_id")`, { transaction });
      await sequelize.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "users_single_super_admin" ON ${usersTable} ("role_id") WHERE "role_id" = :superAdminRoleId`,
        { replacements: { superAdminRoleId: superAdminRole.role_id }, transaction },
      );
    }
    if (await tableExists(queryInterface, "invites", transaction)) {
      await sequelize.query(`CREATE INDEX IF NOT EXISTS "invites_role_id" ON ${invitesTable} ("role_id")`, { transaction });
    }
  });
};

module.exports = { migrateRoleStorage };
