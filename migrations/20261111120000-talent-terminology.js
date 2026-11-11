"use strict";

const { QueryTypes } = require("sequelize");

const schemaFor = (queryInterface) =>
  process.env.DB_SCHEMA || queryInterface.sequelize.options.schema || "public";

const tableFor = (queryInterface, tableName) => ({
  tableName,
  schema: schemaFor(queryInterface),
});

const normalizeTableName = (table) =>
  typeof table === "string" ? table : table.tableName || table.name;

const listTables = async (queryInterface, transaction) =>
  new Set(
    (await queryInterface.showAllTables({
      schema: schemaFor(queryInterface),
      transaction,
    })).map(normalizeTableName),
  );

const quoteTable = (queryInterface, tableName) =>
  queryInterface.queryGenerator.quoteTable(tableFor(queryInterface, tableName));

const renameTable = async (
  queryInterface,
  oldName,
  newName,
  transaction,
  { optional = false } = {},
) => {
  const tables = await listTables(queryInterface, transaction);
  const hasOld = tables.has(oldName);
  const hasNew = tables.has(newName);
  if (hasOld && hasNew) {
    throw new Error(`Cannot rename ${oldName}: ${newName} already exists`);
  }
  if (hasOld) {
    await queryInterface.renameTable(
      tableFor(queryInterface, oldName),
      newName,
      { transaction },
    );
    return;
  }
  if (!hasNew && !optional) {
    throw new Error(`Cannot rename ${oldName}: neither source nor destination exists`);
  }
};

const renameColumn = async (
  queryInterface,
  tableName,
  oldName,
  newName,
  transaction,
  { optional = false } = {},
) => {
  const tables = await listTables(queryInterface, transaction);
  if (!tables.has(tableName)) {
    if (optional) return;
    throw new Error(`Cannot rename ${tableName}.${oldName}: table does not exist`);
  }
  const columns = await queryInterface.describeTable(
    tableFor(queryInterface, tableName),
    { transaction },
  );
  if (columns[oldName] && columns[newName]) {
    throw new Error(
      `Cannot rename ${tableName}.${oldName}: ${newName} already exists`,
    );
  }
  if (columns[oldName]) {
    await queryInterface.renameColumn(
      tableFor(queryInterface, tableName),
      oldName,
      newName,
      { transaction },
    );
    return;
  }
  if (!columns[newName] && !optional) {
    throw new Error(
      `Cannot rename ${tableName}.${oldName}: neither source nor destination exists`,
    );
  }
};

const replaceIdentifier = (value, fromSingular, toSingular) =>
  value
    .replaceAll(`${fromSingular}s`, `${toSingular}s`)
    .replaceAll(fromSingular, toSingular);

const renamePostgresCatalogObjects = async (
  queryInterface,
  fromSingular,
  toSingular,
  transaction,
) => {
  if (queryInterface.sequelize.getDialect() !== "postgres") return;
  const schema = schemaFor(queryInterface);
  const quote = (value) => queryInterface.queryGenerator.quoteIdentifier(value);
  const replacements = { schema, pattern: `%${fromSingular}%` };

  const constraints = await queryInterface.sequelize.query(
    `SELECT c.conname AS name, r.relname AS table_name
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = :schema AND c.conname LIKE :pattern`,
    {
      replacements,
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  for (const constraint of constraints) {
    const nextName = replaceIdentifier(
      constraint.name,
      fromSingular,
      toSingular,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE ${quoteTable(queryInterface, constraint.table_name)} RENAME CONSTRAINT ${quote(constraint.name)} TO ${quote(nextName)}`,
      { transaction },
    );
  }

  const indexes = await queryInterface.sequelize.query(
    `SELECT indexname AS name
       FROM pg_indexes
      WHERE schemaname = :schema AND indexname LIKE :pattern`,
    {
      replacements,
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  for (const index of indexes) {
    const nextName = replaceIdentifier(index.name, fromSingular, toSingular);
    await queryInterface.sequelize.query(
      `ALTER INDEX ${quote(schema)}.${quote(index.name)} RENAME TO ${quote(nextName)}`,
      { transaction },
    );
  }

  const triggers = await queryInterface.sequelize.query(
    `SELECT DISTINCT trigger_name AS name, event_object_table AS table_name
       FROM information_schema.triggers
      WHERE trigger_schema = :schema AND trigger_name LIKE :pattern`,
    {
      replacements,
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  for (const trigger of triggers) {
    const nextName = replaceIdentifier(trigger.name, fromSingular, toSingular);
    await queryInterface.sequelize.query(
      `ALTER TRIGGER ${quote(trigger.name)} ON ${quoteTable(queryInterface, trigger.table_name)} RENAME TO ${quote(nextName)}`,
      { transaction },
    );
  }
};

const updateRole = async (
  queryInterface,
  fromKey,
  fromName,
  toKey,
  toName,
  transaction,
) => {
  const tables = await listTables(queryInterface, transaction);
  if (!tables.has("roles")) return;
  const rolesTable = quoteTable(queryInterface, "roles");
  const roles = await queryInterface.sequelize.query(
    `SELECT role_id, role_key FROM ${rolesTable}
      WHERE LOWER(role_key) IN (:fromKey, :toKey)
      FOR UPDATE`,
    {
      replacements: { fromKey, toKey },
      type: QueryTypes.SELECT,
      transaction,
    },
  );
  const source = roles.find((role) => role.role_key.toLowerCase() === fromKey);
  const destination = roles.find((role) => role.role_key.toLowerCase() === toKey);
  if (source && destination) {
    let destinationReferences = 0;
    for (const tableName of ["users", "invites"]) {
      if (!tables.has(tableName)) continue;
      const columns = await queryInterface.describeTable(
        tableFor(queryInterface, tableName),
        { transaction },
      );
      if (!columns.role_id) continue;
      const result = await queryInterface.sequelize.query(
        `SELECT COUNT(*)::integer AS count
           FROM ${quoteTable(queryInterface, tableName)}
          WHERE role_id = :roleId`,
        {
          replacements: { roleId: destination.role_id },
          type: QueryTypes.SELECT,
          plain: true,
          transaction,
        },
      );
      destinationReferences += Number(result?.count || 0);
    }
    if (destinationReferences > 0) {
      throw new Error(
        `Cannot migrate role ${fromKey}: role ${toKey} already exists and is referenced`,
      );
    }
    await queryInterface.sequelize.query(
      `DELETE FROM ${rolesTable} WHERE role_id = :roleId`,
      {
        replacements: { roleId: destination.role_id },
        transaction,
      },
    );
  }
  if (source) {
    await queryInterface.sequelize.query(
      `UPDATE ${rolesTable}
          SET role_key = :toKey,
              name = CASE WHEN name = :fromName THEN :toName ELSE name END,
              updated_at = CURRENT_TIMESTAMP
        WHERE role_id = :roleId`,
      {
        replacements: {
          toKey,
          fromName,
          toName,
          roleId: source.role_id,
        },
        transaction,
      },
    );
  }

  for (const tableName of ["users", "invites"]) {
    if (!tables.has(tableName)) continue;
    const columns = await queryInterface.describeTable(
      tableFor(queryInterface, tableName),
      { transaction },
    );
    if (columns.role) {
      await queryInterface.sequelize.query(
        `UPDATE ${quoteTable(queryInterface, tableName)} SET role = :toKey WHERE role = :fromKey`,
        { replacements: { fromKey, toKey }, transaction },
      );
    }
  }
};

const updateStoredValues = async (
  queryInterface,
  fromSingular,
  toSingular,
  fromPlural,
  toPlural,
  transaction,
) => {
  const tables = await listTables(queryInterface, transaction);
  if (tables.has("invoices")) {
    const columns = await queryInterface.describeTable(
      tableFor(queryInterface, "invoices"),
      { transaction },
    );
    if (columns.invoice_type) {
      await queryInterface.sequelize.query(
        `UPDATE ${quoteTable(queryInterface, "invoices")} SET invoice_type = :toSingular WHERE invoice_type = :fromSingular`,
        { replacements: { fromSingular, toSingular }, transaction },
      );
    }
  }

  if (!tables.has("notifications")) return;
  const notifications = quoteTable(queryInterface, "notifications");
  const columns = await queryInterface.describeTable(
    tableFor(queryInterface, "notifications"),
    { transaction },
  );
  if (columns.action_url) {
    await queryInterface.sequelize.query(
      `UPDATE ${notifications}
          SET action_url = REPLACE(REPLACE(action_url, :fromPluralPath, :toPluralPath), :fromSingularPath, :toSingularPath)
        WHERE action_url LIKE :fromPathPattern`,
      {
        replacements: {
          fromPluralPath: `/${fromPlural}`,
          toPluralPath: `/${toPlural}`,
          fromSingularPath: `/${fromSingular}`,
          toSingularPath: `/${toSingular}`,
          fromPathPattern: `%/${fromSingular}%`,
        },
        transaction,
      },
    );
  }
  for (const column of ["title", "message"]) {
    if (!columns[column]) continue;
    await queryInterface.sequelize.query(
      `UPDATE ${notifications}
          SET ${queryInterface.queryGenerator.quoteIdentifier(column)} =
            REPLACE(REPLACE(REPLACE(REPLACE(
              ${queryInterface.queryGenerator.quoteIdentifier(column)},
              :fromPluralTitle, :toPluralTitle),
              :fromSingularTitle, :toSingularTitle),
              :fromPlural, :toPlural),
              :fromSingular, :toSingular)
        WHERE ${queryInterface.queryGenerator.quoteIdentifier(column)} LIKE :titlePattern
           OR ${queryInterface.queryGenerator.quoteIdentifier(column)} LIKE :lowerPattern`,
      {
        replacements: {
          fromPluralTitle: `${fromPlural[0].toUpperCase()}${fromPlural.slice(1)}`,
          toPluralTitle: `${toPlural[0].toUpperCase()}${toPlural.slice(1)}`,
          fromSingularTitle: `${fromSingular[0].toUpperCase()}${fromSingular.slice(1)}`,
          toSingularTitle: `${toSingular[0].toUpperCase()}${toSingular.slice(1)}`,
          fromPlural,
          toPlural,
          fromSingular,
          toSingular,
          titlePattern: `%${fromSingular[0].toUpperCase()}${fromSingular.slice(1)}%`,
          lowerPattern: `%${fromSingular}%`,
        },
        transaction,
      },
    );
    const wrongArticleUpper = toSingular === "talent" ? "An Talent" : "A Engineer";
    const rightArticleUpper = toSingular === "talent" ? "A Talent" : "An Engineer";
    const wrongArticleSentence = toSingular === "talent" ? "An talent" : "A engineer";
    const rightArticleSentence = toSingular === "talent" ? "A talent" : "An engineer";
    const wrongArticleLower = toSingular === "talent" ? "an talent" : "a engineer";
    const rightArticleLower = toSingular === "talent" ? "a talent" : "an engineer";
    await queryInterface.sequelize.query(
      `UPDATE ${notifications}
          SET ${queryInterface.queryGenerator.quoteIdentifier(column)} =
            REPLACE(REPLACE(REPLACE(
              ${queryInterface.queryGenerator.quoteIdentifier(column)},
              :wrongArticleUpper, :rightArticleUpper),
              :wrongArticleSentence, :rightArticleSentence),
              :wrongArticleLower, :rightArticleLower)
        WHERE ${queryInterface.queryGenerator.quoteIdentifier(column)} LIKE :wrongUpperPattern
           OR ${queryInterface.queryGenerator.quoteIdentifier(column)} LIKE :wrongSentencePattern
           OR ${queryInterface.queryGenerator.quoteIdentifier(column)} LIKE :wrongLowerPattern`,
      {
        replacements: {
          wrongArticleUpper,
          rightArticleUpper,
          wrongArticleSentence,
          rightArticleSentence,
          wrongArticleLower,
          rightArticleLower,
          wrongUpperPattern: `%${wrongArticleUpper}%`,
          wrongSentencePattern: `%${wrongArticleSentence}%`,
          wrongLowerPattern: `%${wrongArticleLower}%`,
        },
        transaction,
      },
    );
  }
  if (columns.metadata && queryInterface.sequelize.getDialect() === "postgres") {
    const oldId = `${fromSingular}_id`;
    const oldName = `${fromSingular}_name`;
    const oldIds = `${fromSingular}_ids`;
    const newId = `${toSingular}_id`;
    const newName = `${toSingular}_name`;
    const newIds = `${toSingular}_ids`;
    await queryInterface.sequelize.query(
      `UPDATE ${notifications}
          SET metadata = jsonb_strip_nulls(
            (metadata - :oldId - :oldName - :oldIds) ||
            jsonb_build_object(
              :newId, COALESCE(metadata -> :newId, metadata -> :oldId),
              :newName, COALESCE(metadata -> :newName, metadata -> :oldName),
              :newIds, COALESCE(metadata -> :newIds, metadata -> :oldIds)
            )
          )
        WHERE metadata ?| ARRAY[:oldId, :oldName, :oldIds]`,
      {
        replacements: { oldId, oldName, oldIds, newId, newName, newIds },
        transaction,
      },
    );
  }
};

const migrate = async (queryInterface, direction) => {
  const up = direction === "up";
  const fromSingular = up ? "engineer" : "talent";
  const toSingular = up ? "talent" : "engineer";
  const fromPlural = up ? "engineers" : "talents";
  const toPlural = up ? "talents" : "engineers";
  const fromName = up ? "Engineer" : "Talent";
  const toName = up ? "Talent" : "Engineer";

  await queryInterface.sequelize.transaction(async (transaction) => {
    await updateRole(
      queryInterface,
      fromSingular,
      fromName,
      toSingular,
      toName,
      transaction,
    );

    const tables = await listTables(queryInterface, transaction);
    const sourceJoinTables = up
      ? ["engineer_project", "project_engineers"].filter((name) =>
          tables.has(name),
        )
      : ["talent_project", "project_talents"].filter((name) =>
          tables.has(name),
        );
    if (sourceJoinTables.length > 1) {
      throw new Error(
        `Cannot migrate project membership: multiple legacy tables found (${sourceJoinTables.join(", ")})`,
      );
    }

    await renameTable(
      queryInterface,
      fromPlural,
      toPlural,
      transaction,
      { optional: true },
    );
    const joinDestination = up ? "talent_project" : "engineer_project";
    if (sourceJoinTables[0] && sourceJoinTables[0] !== joinDestination) {
      await renameTable(
        queryInterface,
        sourceJoinTables[0],
        joinDestination,
        transaction,
      );
    }

    await renameColumn(
      queryInterface,
      toPlural,
      `${fromSingular}_id`,
      `${toSingular}_id`,
      transaction,
      { optional: true },
    );
    await renameColumn(
      queryInterface,
      "applications",
      `${fromSingular}_id`,
      `${toSingular}_id`,
      transaction,
      { optional: true },
    );
    await renameColumn(
      queryInterface,
      "applications",
      `${fromSingular}_name`,
      `${toSingular}_name`,
      transaction,
      { optional: true },
    );
    await renameColumn(
      queryInterface,
      joinDestination,
      `${fromSingular}_id`,
      `${toSingular}_id`,
      transaction,
      { optional: true },
    );
    await renameColumn(
      queryInterface,
      "projects",
      `${fromSingular}_user_id`,
      `${toSingular}_user_id`,
      transaction,
      { optional: true },
    );
    await renameColumn(
      queryInterface,
      "projects",
      `${fromSingular}_id`,
      `${toSingular}_id`,
      transaction,
      { optional: true },
    );

    await updateStoredValues(
      queryInterface,
      fromSingular,
      toSingular,
      fromPlural,
      toPlural,
      transaction,
    );
    await renamePostgresCatalogObjects(
      queryInterface,
      fromSingular,
      toSingular,
      transaction,
    );
  });
};

module.exports = {
  up: (queryInterface) => migrate(queryInterface, "up"),
  down: (queryInterface) => migrate(queryInterface, "down"),
};
