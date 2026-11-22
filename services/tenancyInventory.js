// Explicit ownership inventory. users remains the global identity table.
const STECHAD_ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const TENANT_TABLES = Object.freeze([
  'admins', 'applications', 'attendance_entries', 'audit_logs', 'chats',
  'ChatParticipants', 'chat_user_states', 'departments', 'expense_claims',
  'holidays', 'interviews', 'invites', 'invoices', 'jobs', 'kpis', 'kpi_appraisals',
  'messages', 'notifications', 'notification_broadcasts', 'projects',
  'project_managers', 'referrals', 'rewards', 'role_permissions', 'roles',
  'settings', 'talents', 'talent_project', 'user_rewards', 'leave_requests', 'stored_files',
]);
// These security records belong to global identity/platform authority, never HR.
const GLOBAL_SECURITY_TABLES = Object.freeze([
  'auth_sessions', 'auth_refresh_tokens', 'auth_legacy_exchanges',
  'auth_security_state', 'auth_oauth_attempts', 'platform_roles',
  'platform_role_grants', 'platform_mfa_credentials',
  'platform_recovery_codes', 'platform_session_assurances',
]);
const PROFILE_FIELDS = Object.freeze([
  'role_id', 'employee_id', 'department_id', 'job_title', 'reports_to_user_id',
  'reporting_manager_mode', 'employment_type', 'hire_date', 'date_of_birth',
  'leave_allowance_days', 'workforce_permissions', 'current_assignment', 'work_region',
  'auto_clock_out_enabled', 'auto_clock_out_time', 'notification_sound_enabled',
  'location_consent_version', 'location_sharing_enabled', 'location_permission_status',
  'browser_latitude', 'browser_longitude', 'browser_location_accuracy',
  'browser_location_updated_at', 'browser_location_address', 'browser_location_city',
  'browser_location_state', 'browser_location_country', 'browser_location_country_code',
  'reward', 'deleted_at', 'deleted_by_user_id',
]);
module.exports = { STECHAD_ORGANIZATION_ID, TENANT_TABLES, GLOBAL_SECURITY_TABLES, PROFILE_FIELDS };
