// Compatibility boundary for the existing HR product. Authentication deliberately
// imports ../models instead: a global account is not an organization membership.
const models = require('../models');
const { Op, literal, where: sqlWhere, col, fn } = require('sequelize');
const { TENANT_TABLES, PROFILE_FIELDS } = require('./tenancyInventory');
const { peekTenantContext, getTenantContext, revalidateTenantContext } = require('./tenantContext');
const db = models.User.sequelize;
const profiles = new Set(PROFILE_FIELDS);
const owned = (model) => TENANT_TABLES.includes(model.tableName) || model === models.HRProfile;
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const quote = (value) => db.getQueryInterface().queryGenerator.quoteIdentifier(value);
const table = (model) => db.getQueryInterface().queryGenerator.quoteTable(model.getTableName());
const originals = new WeakMap();
const facades = new WeakMap();
const decorated = new WeakMap();
const unwrap = (model) => originals.get(model) || model;

function context() {
  const value = peekTenantContext();
  if (!value && process.env.TENANCY_ENFORCED === 'true') return getTenantContext();
  return value;
}
async function access(options = {}, frozen) {
  const current = context();
  if (frozen && (!current || current.organizationId !== frozen.organizationId)) fail('The record belongs to another organization', 403);
  const value = frozen || current;
  if (value) await revalidateTenantContext(value, options);
  return value;
}
function profileSQL(alias, field, tenant) {
  return `(SELECT hp.${quote(field)} FROM ${table(models.HRProfile)} hp WHERE hp.organization_id = ${db.escape(tenant.organizationId)} AND hp.user_id = ${quote(alias)}.${quote('user_id')})`;
}
function activeSQL(alias, tenant) {
  return `(${quote(alias)}.is_active AND (SELECT om.status = 'active' FROM ${table(models.OrganizationMembership)} om WHERE om.organization_id = ${db.escape(tenant.organizationId)} AND om.user_id = ${quote(alias)}.user_id))`;
}
function expression(alias, field, tenant) {
  return literal(field === 'is_active' ? activeSQL(alias, tenant) : profileSQL(alias, field, tenant));
}
function rewriteExpression(value, model, alias, tenant) {
  if (!value || typeof value !== 'object') return value;
  if (value.constructor?.name === 'Col') {
    const parts = value.col.split('.'); const field = parts.at(-1);
    if (model === models.User && (parts.length === 1 || parts[0] === 'User') && (profiles.has(field) || field === 'is_active')) return expression(alias, field, tenant);
    return value;
  }
  if (value.constructor?.name === 'Fn') {
    const copy = Object.create(Object.getPrototypeOf(value)); return Object.assign(copy, value, { args: value.args.map((arg) => rewriteExpression(arg, model, alias, tenant)) });
  }
  return value;
}
function rewriteWhere(input, model, alias, tenant) {
  if (!input || typeof input !== 'object' || input instanceof Date || input.constructor?.name !== 'Object' && !Array.isArray(input)) return rewriteExpression(input, model, alias, tenant);
  if (Array.isArray(input)) return input.map((value) => rewriteWhere(value, model, alias, tenant));
  const next = {}; const conditions = [];
  for (const key of Reflect.ownKeys(input)) {
    const value = input[key];
    if (model === models.User && typeof key === 'string' && (profiles.has(key) || key === 'is_active')) conditions.push(sqlWhere(expression(alias, key, tenant), value));
    else next[key] = rewriteWhere(value, model, alias, tenant);
  }
  return conditions.length ? { [Op.and]: [next, ...conditions] } : next;
}
function scopedOptions(model, input = {}, tenant, alias = model.name, nested = false) {
  const next = { ...input };
  delete next.organization_id;
  if (input.organization_id && input.organization_id !== tenant.organizationId) fail('Conflicting organization identifier');
  if (next.model) next.model = unwrap(next.model);
  let predicate = rewriteWhere(input.where || {}, model, alias, tenant);
  if (owned(model)) predicate = { [Op.and]: [{ organization_id: tenant.organizationId }, predicate] };
  if (model === models.User) {
    const exists = `EXISTS (SELECT 1 FROM ${table(models.HRProfile)} hp JOIN ${table(models.OrganizationMembership)} om ON om.membership_id=hp.membership_id AND om.organization_id=hp.organization_id WHERE hp.organization_id=${db.escape(tenant.organizationId)} AND hp.user_id=${quote(alias)}.user_id)`;
    predicate = { [Op.and]: [literal(exists), predicate, ...(input.paranoid === false ? [] : [sqlWhere(expression(alias, 'deleted_at', tenant), null), { deleted_at: null }])] };
    next.paranoid = false;
    if (!input.attributes && !input._hrAggregate) {
      next.attributes = Object.keys(model.rawAttributes).filter((field) => !['password', 'reset_password_token', 'reset_password_expires'].includes(field));
    }
  }
  next.where = predicate;
  if (nested) next.required = input.required ?? Boolean(input.where);
  if (Array.isArray(next.attributes)) next.attributes = next.attributes.map((attribute) => {
    if (model === models.User && typeof attribute === 'string' && (profiles.has(attribute) || attribute === 'is_active')) return [expression(alias, attribute, tenant), attribute];
    if (Array.isArray(attribute)) return [rewriteExpression(attribute[0], model, alias, tenant), attribute[1]];
    return attribute;
  });
  else if (model === models.User && next.attributes) {
    const excluded = next.attributes.exclude || [];
    next.attributes = Object.keys(model.rawAttributes).filter((field) => !excluded.includes(field) && !['password', 'reset_password_token', 'reset_password_expires'].includes(field)).map((field) => profiles.has(field) || field === 'is_active' ? [expression(alias, field, tenant), field] : field).concat(next.attributes.include || []);
  }
  if (model === models.User && next.attributes?.length && !input._hrAggregate && !input.group && !input.raw) next.attributes = [...next.attributes, [literal(db.escape(tenant.organizationId)), 'organization_id'], [expression(alias, 'membership_id', tenant), 'membership_id']];
  if (next.order) next.order = [].concat(next.order).map((order) => {
    if (Array.isArray(order) && typeof order[0] === 'string' && model === models.User && (profiles.has(order[0]) || order[0] === 'is_active')) return [expression(alias, order[0], tenant), ...order.slice(1)];
    return Array.isArray(order) ? order.map((value) => rewriteExpression(value, model, alias, tenant)) : rewriteExpression(order, model, alias, tenant);
  });
  if (next.group) next.group = [].concat(next.group).map((value) => model === models.User && typeof value === 'string' && profiles.has(value) ? expression(alias, value, tenant) : rewriteExpression(value, model, alias, tenant));
  let includes = input.include ? [].concat(input.include) : [];
  if (model === models.User && !includes.some((entry) => entry.as === 'role' || entry.association === 'role')) includes = [{ model: models.Role, as: 'role', required: true, attributes: input.raw || input._hrAggregate ? [] : ['role_id', 'role_key', 'name', 'description', 'is_system', 'permission_keys'] }, ...includes];
  if (includes.length) next.include = includes.map((entry) => {
    if (!entry || entry.all || typeof entry !== 'object') fail('Use explicit HR includes');
    const association = typeof entry.association === 'string' ? model.associations[entry.association] : entry.association;
    const target = unwrap(entry.model || association?.target || model.associations[entry.as]?.target);
    if (!target || target !== models.User && !owned(target)) fail('Use an explicit organization-owned association');
    const as = entry.as || association?.as;
    const path = nested ? `${alias}->${as}` : as;
    const include = scopedOptions(target, { ...entry, model: target, as }, tenant, path, true);
    if (model === models.User && ['role', 'department', 'reporting_manager'].includes(as)) {
      const field = { role: 'role_id', department: 'department_id', reporting_manager: 'reports_to_user_id' }[as];
      include.on = sqlWhere(col(`${path}.${target.primaryKeyAttribute}`), Op.eq, expression(alias, field, tenant));
    }
    if (target === models.User && ((model === models.Department && as === 'members') || (model === models.User && as === 'direct_reports'))) {
      include.on = sqlWhere(expression(path, as === 'members' ? 'department_id' : 'reports_to_user_id', tenant), Op.eq, col(`${alias}.${model.primaryKeyAttribute}`));
    }
    const relation = model.associations[as];
    if (relation?.through) include.through = { ...(entry.through || {}), where: { [Op.and]: [{ organization_id: tenant.organizationId }, entry.through?.where || {}] } };
    return include;
  });
  // The User compatibility projection only adds one-to-one joins. Keeping these
  // predicates in the same query is essential for directory search pagination.
  if (model === models.User && next.limit && !includes.some((entry) => model.associations[entry.as]?.isMultiAssociation)) next.subQuery = false;
  delete next._hrAggregate;
  return next;
}

async function validateRelations(model, values, tenant, options = {}) {
  if (values.organization_id !== undefined && values.organization_id !== tenant.organizationId) fail('Conflicting organization identifier');
  for (const association of Object.values(model.associations)) {
    if (association.associationType !== 'BelongsTo' || values[association.foreignKey] == null) continue;
    const target = association.target;
    if (!owned(target) && target !== models.User) continue;
    const id = values[association.foreignKey];
    const found = await facade(target).findOne({ where: { [association.targetKey]: id }, transaction: options.transaction, paranoid: false });
    if (!found) fail(`Related ${association.as} was not found in this organization`, 404);
  }
  if (model === models.User) {
    for (const [field, target] of [['role_id', models.Role], ['department_id', models.Department], ['reports_to_user_id', models.User], ['referred_by', models.User]]) {
      if (values[field] != null && !await facade(target).findByPk(values[field], { transaction: options.transaction, paranoid: false })) fail(`Related ${field} was not found in this organization`, 404);
    }
  }
}
const valuesFor = (model, values, tenant) => owned(model) ? { ...values, organization_id: tenant.organizationId } : { ...values };

async function writeUser(row, values, options, tenant) {
  await validateRelations(models.User, values, tenant, options);
  if (['password', 'session_version', 'reset_password_token', 'reset_password_expires', 'is_verified', 'referred_by'].some((key) => Object.hasOwn(values, key))) fail('Global account changes require the identity service', 403);
  const run = async (transaction) => {
    const opts = { ...options, transaction };
    const profile = await models.HRProfile.findOne({ where: { organization_id: tenant.organizationId, user_id: row.user_id }, transaction, lock: transaction.LOCK.UPDATE });
    if (!profile) fail('HR profile was not found', 404);
    const employment = {}; const identity = {};
    for (const [key, value] of Object.entries(values)) {
      if (options.fields && !options.fields.includes(key)) continue;
      if (profiles.has(key)) employment[key] = value;
      else if (key !== 'is_active' && key !== 'organization_id' && key !== 'membership_id') identity[key] = value;
    }
    if (Object.hasOwn(values, 'is_active')) {
      const membership = await models.OrganizationMembership.findOne({ where: { membership_id: profile.membership_id, organization_id: tenant.organizationId }, transaction });
      await require('./organizationMembership').changeMembership({ actor: { user_id: tenant.userId }, organizationId: tenant.organizationId, membershipId: membership.membership_id, updates: { status: values.is_active ? 'active' : 'suspended' }, authority: 'hr', transaction });
    }
    if (Object.keys(employment).length) await profile.update(employment, { ...opts, fields: undefined });
    if (Object.keys(identity).length) await models.User.unscoped().update(identity, { where: { user_id: row.user_id }, transaction, individualHooks: true });
    const fresh = await facade(models.User).findByPk(row.user_id, { ...opts, paranoid: false });
    if (fresh) { row.dataValues = fresh.dataValues; row._previousDataValues = { ...fresh.dataValues }; row._changed.clear(); }
    return row;
  };
  return options.transaction ? run(options.transaction) : db.transaction(run);
}

function decorate(row, model, tenant) {
  if (!row || !row.dataValues) return row;
  if (decorated.has(row)) return row;
  decorated.set(row, tenant);
  Object.defineProperty(row, '_tenantContext', { value: tenant });
  if (model === models.User) for (const key of ['organization_id', 'membership_id']) Object.defineProperty(row, key, { configurable: true, get: () => row.getDataValue(key), set: (value) => row.setDataValue(key, value) });
  const original = {};
  for (const method of ['save', 'update', 'destroy', 'restore', 'reload', 'increment', 'decrement']) if (typeof row[method] === 'function') original[method] = row[method].bind(row);
  row.update = async (values, options = {}) => {
    await access(options, tenant);
    if (row.organization_id !== undefined && row.organization_id !== tenant.organizationId) fail('Conflicting organization identifier');
    if (model === models.User) return writeUser(row, values, options, tenant);
    await validateRelations(model, values, tenant, options);
    if (row.organization_id !== tenant.organizationId) fail('Conflicting organization identifier');
    return original.update(valuesFor(model, values, tenant), options);
  };
  row.save = async (options = {}) => {
    await access(options, tenant);
    if (row.organization_id !== undefined && row.organization_id !== tenant.organizationId) fail('Conflicting organization identifier');
    const values = Object.fromEntries((row.changed() || []).map((key) => [key, row.get(key)]));
    if (model === models.User) return writeUser(row, values, options, tenant);
    await validateRelations(model, values, tenant, options);
    if (row.organization_id !== tenant.organizationId) fail('Conflicting organization identifier');
    return original.save(options);
  };
  row.reload = async (options = {}) => {
    await access(options, tenant);
    const fresh = await facade(model).findByPk(row.get(model.primaryKeyAttribute), options);
    if (!fresh) fail('Resource not found in this organization', 404);
    row.dataValues = fresh.dataValues; row._previousDataValues = { ...fresh.dataValues }; row._changed.clear(); return row;
  };
  row.destroy = async (options = {}) => {
    await access(options, tenant);
    if (model === models.User) return lifecycle(row, false, options, tenant);
    if (row.organization_id !== tenant.organizationId) fail('Conflicting organization identifier');
    return original.destroy(options);
  };
  row.restore = async (options = {}) => {
    await access(options, tenant);
    if (model === models.User) return lifecycle(row, true, options, tenant);
    return original.restore(options);
  };
  for (const method of ['increment', 'decrement']) row[method] = async (fields, options = {}) => {
    await access(options, tenant); if (row.organization_id !== undefined && row.organization_id !== tenant.organizationId) fail('Conflicting organization identifier'); await facade(model)[method](fields, { ...options, where: { [model.primaryKeyAttribute]: row.get(model.primaryKeyAttribute) } }); return row.reload(options);
  };
  for (const association of Object.values(model.associations)) {
    const target = association.target;
    const getter = association.accessors.get;
    if (getter && typeof row[getter] === 'function') {
      const get = row[getter].bind(row);
      row[getter] = async (options = {}) => {
        await access(options, tenant);
        if (!owned(target) && target !== models.User) fail('Use the organization management service', 403);
        if (association.associationType === 'BelongsToMany') return decorateResult(await get({ ...scopedOptions(target, options, tenant), through: { ...options.through, where: { [Op.and]: [{ organization_id: tenant.organizationId }, options.through?.where || {}] } } }), target, tenant);
        const belongs = association.associationType === 'BelongsTo';
        const foreignKey = belongs ? association.targetKey : association.foreignKey;
        const sourceValue = row.get(belongs ? association.foreignKey : association.sourceKey);
        const query = { ...options, where: { [Op.and]: [{ [foreignKey]: sourceValue }, options.where || {}] } };
        return facade(target)[association.isMultiAssociation ? 'findAll' : 'findOne'](query);
      };
    }
    const countName = association.accessors.count;
    if (countName && getter) row[countName] = async (options = {}) => { const result = await row[getter](options); return Array.isArray(result) ? result.length : result ? 1 : 0; };
    for (const key of ['hasSingle', 'hasAll']) {
      const name = association.accessors[key]; if (!name || !getter) continue;
      row[name] = async (input, options = {}) => {
        const result = [].concat(await row[getter](options) || []);
        const ids = new Set(result.map((item) => String(item.get(target.primaryKeyAttribute))));
        return [].concat(input || []).every((item) => ids.has(String(typeof item === 'object' ? item.get?.(target.primaryKeyAttribute) || item[target.primaryKeyAttribute] : item)));
      };
    }
    for (const method of ['set', 'add', 'addMultiple', 'remove', 'removeMultiple', 'create']) {
      const name = association.accessors[method];
      if (!name || typeof row[name] !== 'function') continue;
      row[name] = async (input, options = {}) => {
        await access(options, tenant);
        if (!owned(target) && target !== models.User) fail('Use the organization management service', 403);
        if (method === 'create') {
          if (association.associationType === 'BelongsTo') { const related = await facade(target).create(input, options); await row.update({ [association.foreignKey]: related.get(association.targetKey) }, options); return related; }
          if (association.associationType === 'BelongsToMany') { const related = await facade(target).create(input, options); await row[association.accessors.add](related, options); return related; }
          return facade(target).create({ ...input, [association.foreignKey]: row.get(association.sourceKey) }, options);
        }
        const ids = [];
        for (const value of [].concat(input || [])) {
          const id = typeof value === 'object' ? value.get?.(target.primaryKeyAttribute) || value[target.primaryKeyAttribute] : value;
          if (!await facade(target).findByPk(id, { transaction: options.transaction, paranoid: false })) fail('Related record was not found in this organization', 404);
          ids.push(id);
        }
        if (association.associationType === 'BelongsTo') return row.update({ [association.foreignKey]: input == null ? null : typeof input === 'object' ? input.get(target.primaryKeyAttribute) : input }, options);
        const sourceId = row.get(association.sourceKey);
        const remove = method === 'remove' || method === 'removeMultiple';
        const run = async (transaction) => {
          const opts = { ...options, transaction };
          if (association.associationType === 'BelongsToMany') {
            const through = facade(association.through.model);
            if (method === 'set' || remove) await through.destroy({ ...opts, where: { [association.foreignKey]: sourceId, ...(remove ? { [association.otherKey]: { [Op.in]: ids } } : {}) } });
            if (!remove && ids.length) await through.bulkCreate(ids.map((id) => ({ ...options.through, [association.foreignKey]: sourceId, [association.otherKey]: id })), { ...opts, ignoreDuplicates: true });
          } else {
            const targetFacade = facade(target);
            if (method === 'set' || remove) await targetFacade.update({ [association.foreignKey]: null }, { ...opts, where: { [association.foreignKey]: sourceId, ...(remove ? { [target.primaryKeyAttribute]: { [Op.in]: ids } } : { [target.primaryKeyAttribute]: { [Op.notIn]: ids } }) } });
            if (!remove && ids.length) await targetFacade.update({ [association.foreignKey]: sourceId }, { ...opts, where: { [target.primaryKeyAttribute]: { [Op.in]: ids } } });
          }
          return row;
        };
        return options.transaction ? run(options.transaction) : db.transaction(run);
      };
    }
  }
  for (const [as, association] of Object.entries(model.associations)) if (row.dataValues[as]) decorateResult(row.dataValues[as], association.target, tenant);
  return row;
}
function decorateResult(result, model, tenant) {
  if (Array.isArray(result)) return result.map((row) => decorate(row, model, tenant));
  if (result?.rows) { result.rows = decorateResult(result.rows, model, tenant); return result; }
  return decorate(result, model, tenant);
}
async function lifecycle(row, restore, options, tenant) {
  const run = async (transaction) => {
    const profile = await models.HRProfile.findOne({ where: { organization_id: tenant.organizationId, user_id: row.user_id }, transaction });
    if (!profile) fail('HR profile was not found', 404);
    await require('./organizationMembership').changeMembership({ actor: { user_id: tenant.userId }, organizationId: tenant.organizationId, membershipId: profile.membership_id, updates: { status: restore ? 'active' : 'removed' }, authority: 'hr', transaction });
    await profile.update({ deleted_at: restore ? null : new Date(), archived_at: restore ? null : new Date() }, { transaction });
    return row;
  };
  return options.transaction ? run(options.transaction) : db.transaction(run);
}

function facade(model) {
  if (facades.has(model)) return facades.get(model);
  const methods = {};
  for (const name of ['findAll', 'findOne', 'findByPk', 'findAndCountAll', 'count', 'sum', 'min', 'max', 'aggregate', 'create', 'bulkCreate', 'update', 'upsert', 'destroy', 'restore', 'increment', 'decrement', 'findOrCreate', 'findCreateFind']) methods[name] = async (...args) => {
    const optionIndex = ['create', 'bulkCreate', 'update', 'upsert', 'increment', 'decrement', 'findByPk', 'sum', 'min', 'max'].includes(name) ? 1 : name === 'aggregate' ? 2 : 0;
    const options = args[optionIndex] || {};
    const tenant = await access(options);
    if (!tenant) return model[name](...args);
    if (model === models.User && ['sum', 'min', 'max', 'aggregate'].includes(name)) {
      const field = args[0]; const operation = name === 'aggregate' ? args[1] : name;
      if (typeof field !== 'string' || !models.User.rawAttributes[field] || !['sum', 'min', 'max', 'count'].includes(String(operation).toLowerCase())) fail('Use an explicit supported HR aggregate');
      const attribute = profiles.has(field) || field === 'is_active' ? expression(model.name, field, tenant) : col(`${model.name}.${field}`);
      const query = scopedOptions(model, { ...options, attributes: [[fn(operation, attribute), 'value']], raw: true, _hrAggregate: true }, tenant);
      const result = await model.unscoped().findAll(query);
      return options.group ? result : result[0]?.value == null ? null : Number(result[0].value);
    }
    if (name === 'upsert') {
      if (model === models.User) fail('Create identities through organization invitations', 403);
      const values = args[0]; await validateRelations(model, values, tenant, options);
      const unique = model.options.indexes.find((index) => index.unique && index.fields.every((field) => field === 'organization_id' || values[field] !== undefined));
      const keys = unique?.fields || model.primaryKeyAttributes;
      if (keys.some((key) => key !== 'organization_id' && values[key] === undefined)) fail('A scoped unique key is required for upsert');
      const predicate = Object.fromEntries(keys.map((key) => [key, key === 'organization_id' ? tenant.organizationId : values[key]]));
      const run = async (transaction) => {
        await db.query('SELECT pg_advisory_xact_lock(hashtext(:key))', { replacements: { key: `${model.tableName}:${tenant.organizationId}:${JSON.stringify(predicate)}` }, transaction });
        const existing = await methods.findOne({ ...options, where: predicate, transaction });
        if (existing) return [await existing.update(values, { ...options, transaction }), false];
        return [await methods.create(values, { ...options, transaction }), true];
      };
      return options.transaction ? run(options.transaction) : db.transaction(run);
    }
    if (name === 'findOrCreate' || name === 'findCreateFind') {
      const row = await methods.findOne(options); if (row) return [row, false];
      return [await methods.create({ ...(options.defaults || {}), ...options.where }, options), true];
    }
    if (['create', 'bulkCreate'].includes(name)) {
      if (model === models.User) fail('Create identities through organization invitations', 403);
      if (options.include || options.updateOnDuplicate) fail('Create related HR records explicitly');
      const values = name === 'bulkCreate' ? args[0] : [args[0]];
      for (const value of values) await validateRelations(model, value, tenant, options);
      args[0] = name === 'bulkCreate' ? values.map((v) => valuesFor(model, v, tenant)) : valuesFor(model, args[0], tenant);
      args[optionIndex] = { ...options, fields: options.fields ? [...new Set([...options.fields, 'organization_id'])] : undefined };
    } else if (model === models.User && ['update', 'destroy', 'restore', 'increment', 'decrement'].includes(name)) {
      if (!options.transaction) return db.transaction((transaction) => { const transactional = [...args]; transactional[optionIndex] = { ...options, transaction }; return methods[name](...transactional); });
      const rows = await methods.findAll({ ...options, attributes: undefined, raw: false });
      for (const row of rows) {
        if (name === 'update') await row.update(args[0], options);
        else if (name === 'destroy' || name === 'restore') await row[name](options);
        else {
          const fields = typeof args[0] === 'string' ? [args[0]] : Array.isArray(args[0]) ? args[0] : Object.keys(args[0]);
          if (fields.some((field) => !profiles.has(field))) fail('Only organization profile balances may be incremented');
          await models.HRProfile[name](args[0], { ...options, where: { organization_id: tenant.organizationId, user_id: row.user_id } });
        }
      }
      return name === 'update' ? options.returning ? [rows.length, rows] : [rows.length] : rows.length;
    } else {
      if (['update', 'increment', 'decrement'].includes(name)) { await validateRelations(model, args[0], tenant, options); args[0] = name === 'update' ? valuesFor(model, args[0], tenant) : args[0]; }
      let queryOptions = options;
      if (name === 'findByPk') queryOptions = { ...options, where: { [Op.and]: [options.where || {}, { [model.primaryKeyAttribute]: args[0] }] } };
      if (['count', 'sum', 'min', 'max', 'aggregate'].includes(name)) queryOptions = { ...queryOptions, _hrAggregate: true };
      args[optionIndex] = scopedOptions(model, queryOptions, tenant);
      if (name === 'findByPk') return decorateResult(await model.unscoped().findOne(args[1]), model, tenant);
    }
    const result = await model.unscoped()[name](...args);
    return decorateResult(result, model, tenant);
  };
  let proxy;
  proxy = new Proxy(model, { get(target, key) {
    if (key === 'unscoped' || key === 'scope') return () => proxy;
    if (key === 'getInitialModel') return () => model;
    if (methods[key]) return methods[key];
    const value = Reflect.get(target, key); return typeof value === 'function' && !['prototype', 'constructor'].includes(key) ? value.bind(target) : value;
  } });
  originals.set(proxy, model); facades.set(model, proxy); return proxy;
}
const exportsForHR = {};
for (const [name, model] of Object.entries(models)) exportsForHR[name] = model === models.User || owned(model) ? facade(model) : model;
module.exports = { ...exportsForHR, GlobalUser: models.User, getInstanceTenant: (row) => decorated.get(row), scopedOptions, unwrap };
