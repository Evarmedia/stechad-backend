const router = require('express').Router();
const { authenticateIdentity } = require('../middleware/auth');
const { requireAccess, audit } = require('../services/platformAuthorization');
const mfa = require('../services/platformMfa');
const admin = require('../services/platformAdministration');
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
router.use(authenticateIdentity);
router.use((req, res, next) => requireAccess(req).then(() => next(), next));
router.get('/me', wrap(async (req, res) => {
  const current = await mfa.status(req);
  const user = Object.fromEntries(['user_id', 'email', 'first_name', 'last_name'].map((field) => [field, req.identity[field]]));
  res.json({ success: true, data: { user, roles: req.platform.roles.map(({ role_id, role_key, name }) => ({ role_id, role_key, name })), permissions: req.platform.permissions, mfa: current, requires_mfa_enrollment: !current.enrolled } });
}));
router.post('/mfa/enroll', wrap(async (req, res) => res.json({ success: true, data: await mfa.enroll(req) })));
router.post('/mfa/confirm', wrap(async (req, res) => res.json({ success: true, data: await mfa.confirm(req) })));
router.post('/mfa/verify', wrap(async (req, res) => res.json({ success: true, data: await mfa.verify(req) })));
const protectedRoute = (method, path, permission, handler, status = 200) => router[method](path, wrap(async (req, res) => {
  await requireAccess(req, permission); await mfa.requireAssurance(req);
  res.status(status).json({ success: true, data: await handler(req) });
}));
protectedRoute('get', '/organizations', 'platform.organizations.read', (req) => admin.organizations(req.query));
protectedRoute('patch', '/organizations/:organizationId', 'platform.organizations.manage', admin.updateOrganization);
protectedRoute('get', '/users', 'platform.users.read', (req) => admin.users(req.query));
protectedRoute('patch', '/users/:userId', 'platform.users.manage', admin.updateUser);
protectedRoute('get', '/roles', 'platform.grants.read', admin.roleCatalog);
protectedRoute('get', '/grants', 'platform.grants.read', (req) => admin.grants(req.query));
protectedRoute('post', '/grants', 'platform.grants.manage', admin.grantRole, 201);
protectedRoute('delete', '/grants/:grantId', 'platform.grants.manage', admin.revokeGrant);
protectedRoute('get', '/audit-log', 'platform.audit.read', (req) => admin.audits(req.query));
router.use(async (error, req, res, next) => {
  if (error.status && req.identity && !req.platformDenialAudited) {
    try { await audit(req.identity, 'platform.access.denied', 'Platform', null, { code: error.code || 'PLATFORM_REQUEST_FAILED' }, undefined, 'denied'); } catch { /* Preserve the denial even if the audit store is unavailable. */ }
  }
  res.status(error.status || 500).json({ success: false, code: error.code || 'PLATFORM_REQUEST_FAILED', message: error.status ? error.message : 'Platform request failed' });
});
module.exports = router;
