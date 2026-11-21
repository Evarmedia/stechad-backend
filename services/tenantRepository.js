const { Op } = require('sequelize');
const { TENANT_TABLES } = require('./tenancyInventory');
const { getTenantContext, revalidateTenantContext } = require('./tenantContext');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const owned = (model) => TENANT_TABLES.includes(model.tableName) || model.tableName === 'hr_profiles';
function assertOwned(model) { if (!owned(model)) fail('This repository requires a tenant-owned model'); }
function scopedOptions(model, options, organizationId) {
  if (options?.raw && options?.nest) fail('Nested raw queries require an explicit scoped projection');
  const next = { ...options, where: { [Op.and]: [{ organization_id: organizationId }, options?.where || {}] } };
  // Sequelize association scopes must not turn required tenant filters into ORs.
  if (options?.include) next.include = [].concat(options.include).map((input) => {
    if (typeof input !== 'object' || input.all) fail('Use explicit tenant-owned includes');
    const association = typeof input.association === 'string' ? model.associations[input.association] : input.association;
    const target = input.model || association?.target || model.associations[input.as]?.target;
    if (!target || !owned(target)) fail('Identity includes require the HR identity projection');
    const include = scopedOptions(target, input, organizationId);
    if (include.through) include.through = { ...include.through, where: { [Op.and]: [{ organization_id: organizationId }, include.through.where || {}] } };
    return include;
  });
  return next;
}
function tenantRepository(model, explicitContext) {
  assertOwned(model);
  const access = async (options = {}) => {
    const context = explicitContext || getTenantContext();
    await revalidateTenantContext(context, options);
    return { context, options: scopedOptions(model, options, context.organizationId) };
  };
  const valuesFor = (values, context) => {
    if (!values || Array.isArray(values)) fail('Expected a record');
    if (values.organization_id !== undefined && values.organization_id !== context.organizationId) fail('Conflicting organization identifier');
    return { ...values, organization_id: context.organizationId };
  };
  return Object.freeze({
    async findAll(options = {}) { const scoped = await access(options); return model.findAll(scoped.options); },
    async findOne(options = {}) { const scoped = await access(options); return model.findOne(scoped.options); },
    async findByPk(id, options = {}) {
      if (model.primaryKeyAttributes.length !== 1) fail('Composite keys require an explicit where predicate');
      const scoped = await access({ ...options, where: { [Op.and]: [options.where || {}, { [model.primaryKeyAttribute]: id }] } });
      return model.findOne(scoped.options);
    },
    async count(options = {}) { const scoped = await access(options); return model.count(scoped.options); },
    async findAndCountAll(options = {}) { const scoped = await access(options); return model.findAndCountAll(scoped.options); },
    async create(values, options = {}) {
      if (options.include) fail('Create related records explicitly through their scoped repository');
      const { context } = await access(options);
      return model.create(valuesFor(values, context), { ...options, fields: options.fields ? [...new Set([...options.fields, 'organization_id'])] : undefined });
    },
    async bulkCreate(values, options = {}) {
      if (options.include || options.updateOnDuplicate) fail('Bulk association/upsert operations require an explicit scoped implementation');
      const { context } = await access(options);
      return model.bulkCreate(values.map((value) => valuesFor(value, context)), { ...options, fields: options.fields ? [...new Set([...options.fields, 'organization_id'])] : undefined });
    },
    async update(values, options = {}) {
      const scoped = await access(options);
      return model.update(valuesFor(values, scoped.context), scoped.options);
    },
    async destroy(options = {}) { const scoped = await access(options); return model.destroy(scoped.options); },
    // Lookup proves existence and organization before assigning a relation. DB
    // composite constraints are the final protection against concurrent changes.
    async require(id, options = {}) { const row = await this.findByPk(id, options); if (!row) fail('Resource not found in this organization', 404); return row; },
  });
}
module.exports = { tenantRepository, scopedOptions };
