// This fixed catalog is independent of tenant HR roles and token claims.
const PERMISSIONS = Object.freeze([
  'platform.organizations.read', 'platform.organizations.manage',
  'platform.users.read', 'platform.users.manage',
  'platform.grants.read', 'platform.grants.manage', 'platform.audit.read',
]);
const ROLES = Object.freeze([
  { role_id: '41ad1710-482c-4000-8000-000000000001', role_key: 'platform_super_admin', name: 'Platform super admin', permission_keys: [...PERMISSIONS] },
  { role_id: '41ad1710-482c-4000-8000-000000000002', role_key: 'platform_operator', name: 'Platform operator', permission_keys: PERMISSIONS.filter((key) => !key.startsWith('platform.grants.')) },
  { role_id: '41ad1710-482c-4000-8000-000000000003', role_key: 'platform_viewer', name: 'Platform viewer', permission_keys: PERMISSIONS.filter((key) => key.endsWith('.read') && key !== 'platform.grants.read') },
]);
module.exports = { PERMISSIONS, ROLES };
