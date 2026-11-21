const router = require('express').Router();
const { authenticateIdentity } = require('../middleware/auth');
const service = require('../services/organizationMembership');
const wrap = (fn) => async (req, res) => { try { await fn(req, res); } catch (error) { res.status(error.status || (error.name === 'SequelizeUniqueConstraintError' ? 409 : 500)).json({ success: false, message: error.message, code: error.code }); } };
router.use(authenticateIdentity);
router.get('/', wrap(async (req, res) => res.json({ success: true, data: { organizations: await service.listOrganizations(req.user.user_id) } })));
router.post('/', wrap(async (req, res) => res.status(201).json({ success: true, data: await service.createOrganization(req.user, req.body) })));
router.get('/:organizationId', wrap(async (req, res) => { const membership = await service.requireMembership(req.user.user_id, req.params.organizationId); res.json({ success: true, data: { organization: membership.organization } }); }));
router.patch('/:organizationId', wrap(async (req, res) => {
  service.uuid(req.params.organizationId);
  const sequelize = require('../config/database');
  const organization = await sequelize.transaction(async (transaction) => {
    const { Organization } = require('../models');
    const row = await Organization.findByPk(req.params.organizationId, { transaction, lock: transaction.LOCK.UPDATE });
    await service.requireMembership(req.user.user_id, req.params.organizationId, { manage: true, transaction });
    const values = {};
    if (req.body.name !== undefined) { if (typeof req.body.name !== 'string' || !req.body.name.trim() || req.body.name.length > 200) throw service.fail('Invalid organization name', 400); values.name = req.body.name.trim(); }
    if (req.body.settings !== undefined) { if (!req.body.settings || Array.isArray(req.body.settings) || typeof req.body.settings !== 'object' || JSON.stringify(req.body.settings).length > 10000) throw service.fail('Invalid organization settings', 400); values.settings = req.body.settings; }
    if (!Object.keys(values).length) throw service.fail('A settings change is required', 400);
    await row.update(values, { transaction });
    await service.audit(req.user, row.organization_id, 'organization.settings_updated', row.organization_id, { changed_fields: Object.keys(values) }, transaction);
    return row;
  });
  res.json({ success: true, data: { organization } });
}));
router.get('/:organizationId/members', wrap(async (req, res) => {
  const { OrganizationMembership, User, HRProfile } = require('../models');
  await service.requireMembership(req.user.user_id, req.params.organizationId, { manage: true });
  const members = await OrganizationMembership.findAll({ where: { organization_id: req.params.organizationId }, include: [{ model: User.unscoped(), as: 'user', attributes: ['user_id', 'email', 'first_name', 'last_name'] }], order: [['created_at', 'ASC']] });
  res.json({ success: true, data: { members } });
}));
router.patch('/:organizationId/members/:membershipId', wrap(async (req, res) => res.json({ success: true, data: { membership: await service.changeMembership({ actor: req.user, organizationId: req.params.organizationId, membershipId: req.params.membershipId, updates: req.body }) } })));
router.delete('/:organizationId/members/:membershipId', wrap(async (req, res) => res.json({ success: true, data: { membership: await service.changeMembership({ actor: req.user, organizationId: req.params.organizationId, membershipId: req.params.membershipId, updates: { status: 'removed' } }) } })));
router.post('/:organizationId/leave', wrap(async (req, res) => {
  const membership = await service.requireMembership(req.user.user_id, req.params.organizationId);
  res.json({ success: true, data: { membership: await service.changeMembership({ actor: req.user, organizationId: req.params.organizationId, membershipId: membership.membership_id, updates: { status: 'removed' }, leave: true }) } });
}));
router.post('/:organizationId/invitations', wrap(async (req, res) => {
  const invitations = require('../services/organizationInvitations');
  const result = await require('../config/database').transaction(async (transaction) => {
    const result = await invitations.createInvitation({ actor: req.user, organizationId: req.params.organizationId, input: req.body, transaction });
    await invitations.sendInvitation(result);
    return result;
  });
  res.status(201).json({ success: true, data: { invitation: result.invitation } });
}));
module.exports = router;
