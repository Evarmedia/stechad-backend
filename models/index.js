const AuditLog = require("./AuditLog");
const IdentityAuditLog = require('./IdentityAuditLog');
const StoredFile = require('./StoredFile');
const NotificationBroadcast = require("./NotificationBroadcast");
// Models
const User = require("./User");
const Talent = require("./Talent");
const ProjectManager = require("./ProjectManager");
const Admin = require("./Admin");
const Job = require("./Job");
const Application = require("./Application");
const Project = require("./Project");
const Interview = require("./Interview");
const Chat = require("./Chat");
const ChatUserState = require("./ChatUserState");
const Message = require("./Message");
const Notification = require("./Notification");
const Setting = require("./Setting");
const Invite = require("./Invite");
const Department = require("./Department");
const Attendance = require("./Attendance");
const LeaveRequest = require("./LeaveRequest");
const ExpenseClaim = require("./ExpenseClaim");
const Holiday = require("./Holiday");
const Kpi = require("./Kpi");
const KpiAppraisal = require("./KpiAppraisal");
const Invoice = require("./Invoice");
const RolePermission = require("./RolePermission");
const Role = require("./Role");
const { Referral } = require("./Referral");
const { Reward } = require("./Reward");
const { UserReward  } = require("./UserReward");

/* =========================
   USER ↔ ROLE RELATIONSHIPS
   ========================= */

Role.hasMany(User, { foreignKey: "role_id", as: "users", onDelete: "RESTRICT", onUpdate: "CASCADE" });
User.belongsTo(Role, { foreignKey: "role_id", as: "role", onDelete: "RESTRICT", onUpdate: "CASCADE" });
Role.hasMany(Invite, { foreignKey: "role_id", as: "invites", onDelete: "RESTRICT", onUpdate: "CASCADE" });
Invite.belongsTo(Role, { foreignKey: "role_id", as: "role", onDelete: "RESTRICT", onUpdate: "CASCADE" });

// User - Talent (One-to-One)
User.hasOne(Talent, {
  foreignKey: "user_id",
  as: "talent",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Talent.belongsTo(User, { foreignKey: "user_id", as: "user" });

// Talent vetted by Admin(User) (Many-to-One)
Talent.belongsTo(User, {
  foreignKey: "vetted_by",
  as: "vettedBy",
  onDelete: "SET NULL",
});
User.hasMany(Talent, {
  foreignKey: "vetted_by",
  as: "vettedTalents",
});

// User - ProjectManager (One-to-One)
User.hasOne(ProjectManager, {
  foreignKey: "user_id",
  as: "project_manager",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
ProjectManager.belongsTo(User, { foreignKey: "user_id", as: "user" });

// User - Admin (One-to-One)
User.hasOne(Admin, {
  foreignKey: "user_id",
  as: "admin",
  onDelete: "CASCADE",
});
Admin.belongsTo(User, { foreignKey: "user_id", as: "user" });

// Department -> Manager (Staff / Admin user)
Department.belongsTo(User, {
  foreignKey: "manager_user_id",
  as: "manager",
  onDelete: "SET NULL",
});

User.hasMany(Department, {
  foreignKey: "manager_user_id",
  as: "managed_departments",
  onDelete: "SET NULL",
});

// Department -> Members
Department.hasMany(User, {
  foreignKey: "department_id",
  as: "members",
  onDelete: "SET NULL",
});

// User -> Department
// constraints: false breaks the circular database dependency.
// The Sequelize association remains available for queries.
User.belongsTo(Department, {
  foreignKey: "department_id",
  as: "department",
  constraints: false,
});

// User -> reporting manager (self-reference)
// constraints: false keeps this query association compatible with existing
// databases where reports_to_user_id was added without a foreign key.
User.belongsTo(User, {
  foreignKey: "reports_to_user_id",
  as: "reporting_manager",
  constraints: false,
});

User.hasMany(User, {
  foreignKey: "reports_to_user_id",
  as: "direct_reports",
  constraints: false,
});

/* =========================
   WORKFORCE OPERATIONS
   ========================= */

User.hasMany(Attendance, { foreignKey: "user_id", as: "attendance_entries", onDelete: "CASCADE" });
Attendance.belongsTo(User, { foreignKey: "user_id", as: "user" });

User.hasMany(LeaveRequest, { foreignKey: "user_id", as: "leave_requests", onDelete: "CASCADE" });
LeaveRequest.belongsTo(User, { foreignKey: "user_id", as: "requester" });
LeaveRequest.belongsTo(User, { foreignKey: "reviewed_by", as: "reviewer" });
User.hasMany(LeaveRequest, { foreignKey: "reviewed_by", as: "reviewed_leave_requests" });

User.hasMany(ExpenseClaim, { foreignKey: "user_id", as: "expense_claims", onDelete: "CASCADE" });
ExpenseClaim.belongsTo(User, { foreignKey: "user_id", as: "claimant" });
ExpenseClaim.belongsTo(User, { foreignKey: "reviewed_by", as: "reviewer" });
ExpenseClaim.belongsTo(User, { foreignKey: "accounts_verified_by", as: "accounts_verifier" });
User.hasMany(ExpenseClaim, { foreignKey: "reviewed_by", as: "reviewed_expense_claims" });
User.hasMany(ExpenseClaim, { foreignKey: "accounts_verified_by", as: "verified_expense_claims" });

User.hasMany(Holiday, { foreignKey: "created_by", as: "created_holidays" });
Holiday.belongsTo(User, { foreignKey: "created_by", as: "creator" });

User.hasMany(Kpi, { foreignKey: "assigned_to_user_id", as: "assigned_kpis", onDelete: "CASCADE" });
Kpi.belongsTo(User, { foreignKey: "assigned_to_user_id", as: "assignee" });
User.hasMany(Kpi, { foreignKey: "created_by", as: "created_kpis" });
Kpi.belongsTo(User, { foreignKey: "created_by", as: "creator" });
Kpi.hasMany(KpiAppraisal, { foreignKey: "kpi_id", as: "appraisals", onDelete: "CASCADE" });
KpiAppraisal.belongsTo(Kpi, { foreignKey: "kpi_id", as: "kpi" });
User.hasMany(KpiAppraisal, { foreignKey: "recorded_by", as: "recorded_kpi_appraisals" });
KpiAppraisal.belongsTo(User, { foreignKey: "recorded_by", as: "recorder" });

User.hasMany(Invoice, { foreignKey: "submitted_by", as: "submitted_invoices", onDelete: "CASCADE" });
Invoice.belongsTo(User, { foreignKey: "submitted_by", as: "submitter" });
Invoice.belongsTo(User, { foreignKey: "reviewed_by", as: "reviewer" });
User.hasMany(Invoice, { foreignKey: "reviewed_by", as: "reviewed_invoices" });
Project.hasMany(Invoice, { foreignKey: "project_id", as: "invoices", onDelete: "SET NULL" });
Invoice.belongsTo(Project, { foreignKey: "project_id", as: "project" });

/* =========================
   JOB & APPLICATION
   ========================= */

// User (poster) - Job (One-to-Many)
User.hasMany(Job, {
  foreignKey: "posted_by",
  as: "poster",
});
Job.belongsTo(User, { foreignKey: "posted_by", as: "poster" });

// Job - Application (One-to-Many)
Job.hasMany(Application, {
  foreignKey: "job_id",
  as: "applications",
  onDelete: "NO ACTION",
  onUpdate: "CASCADE",
});
Application.belongsTo(Job, { foreignKey: "job_id", as: "job" });

// Talent - Application (One-to-Many)
// 🔧 FIXED: Application MUST belong to Talent, not User
Talent.hasMany(Application, {
  foreignKey: "talent_id",
  as: "applications",
  onDelete: "CASCADE",
});
Application.belongsTo(Talent, {
  foreignKey: "talent_id",
  as: "applicant",
});

/* =========================
   PROJECT MANAGEMENT
   ========================= */

// ProjectManager - Project (One-to-Many)
ProjectManager.hasMany(Project, {
  foreignKey: "project_managers_id",
  as: "pm_projects",
});
Project.belongsTo(ProjectManager, {
  foreignKey: "project_managers_id",
  as: "project_manager",
  onDelete: "SET NULL",
  onUpdate: "CASCADE",
});

// Project ↔ Talent (Many-to-Many)
Talent.belongsToMany(Project, {
  through: "talent_project",
  as: "talent_projects",
  foreignKey: "talent_id",
  otherKey: "projects_id",
});
Project.belongsToMany(Talent, {
  through: "talent_project",
  as: "talents",
  foreignKey: "projects_id",
  otherKey: "talent_id",
});

/* =========================
   INTERVIEWS
   ========================= */

Interview.belongsTo(Talent, {
  as: "candidate",
  foreignKey: "candidate_id",
  targetKey: "talent_id",
  onDelete: "CASCADE",
});
Talent.hasMany(Interview, {
  as: "interviews",
  foreignKey: "candidate_id",
  sourceKey: "talent_id",
});

Interview.belongsTo(ProjectManager, {
  as: "interviewer",
  foreignKey: "interviewer_id",
  targetKey: "project_managers_id",
  onDelete: "CASCADE",
});
ProjectManager.hasMany(Interview, {
  as: "interviews",
  foreignKey: "interviewer_id",
  sourceKey: "project_managers_id",
});

Interview.belongsTo(Job, {
  as: "job",
  foreignKey: "job_id",
  targetKey: "jobs_id",
});
Job.hasMany(Interview, {
  as: "interviews",
  foreignKey: "job_id",
  sourceKey: "jobs_id",
});

/* =========================
   CHAT & MESSAGING
   ========================= */

// User - Chat (Many-to-Many)
User.belongsToMany(Chat, {
  through: "ChatParticipants",
  foreignKey: "user_id",
  as: "user_chats",
});
Chat.belongsToMany(User, {
  through: "ChatParticipants",
  foreignKey: "chat_id",
  as: "chat_users",
});

// Chat - Message
Chat.hasMany(Message, {
  foreignKey: "chat_id",
  as: "messages",
  onDelete: "CASCADE",
});
Message.belongsTo(Chat, { foreignKey: "chat_id", as: "chat" });

// User - Message
User.hasMany(Message, {
  foreignKey: "sender_id",
  as: "sent_messages",
  onDelete: "CASCADE",
});
Message.belongsTo(User, { foreignKey: "sender_id", as: "sender" });

// Message replies (self-reference)
Message.belongsTo(Message, {
  foreignKey: "reply_to",
  as: "replyToMessage",
  onDelete: "SET NULL",
});
Message.hasMany(Message, {
  foreignKey: "reply_to",
  as: "replies",
});

/* =========================
   NOTIFICATIONS
   ========================= */

User.hasMany(Notification, {
  foreignKey: "user_id",
  as: "notifications",
  onDelete: "CASCADE",
});
Notification.belongsTo(User, {
  foreignKey: "user_id",
  as: "user_notifications",
});

/* =========================
   REFERRALS & REWARDS
   ========================= */

User.hasMany(Referral, { foreignKey: "referrer_id", as: "referralsMade" });
User.hasMany(Referral, { foreignKey: "referee_id", as: "referralsReceived" });

Referral.belongsTo(User, {
  foreignKey: "referrer_id",
  as: "referrer",
  onDelete: "CASCADE",
});
Referral.belongsTo(User, {
  foreignKey: "referee_id",
  as: "referee",
  onDelete: "CASCADE",
});

Reward.hasMany(UserReward, {
  foreignKey: "reward_id",
  onDelete: "CASCADE",
});
UserReward.belongsTo(Reward, { foreignKey: "reward_id" });

User.hasMany(UserReward, {
  foreignKey: "user_id",
  onDelete: "CASCADE",
});
UserReward.belongsTo(User, { foreignKey: "user_id" });

Referral.hasMany(UserReward, {
  foreignKey: "referral_id",
  onDelete: "CASCADE",
});
UserReward.belongsTo(Referral, {
  foreignKey: "referral_id",
  as: "referral",
});

module.exports = {
  IdentityAuditLog,
  StoredFile,
  AuditLog,
  NotificationBroadcast,
  User,
  Talent,
  ProjectManager,
  Admin,
  Job,
  Application,
  Project,
  Interview,
  Chat,
  ChatUserState,
  Message,
  Notification,
  Setting,
  Invite,
  Department,
  Attendance,
  LeaveRequest,
  ExpenseClaim,
  Holiday,
  Kpi,
  KpiAppraisal,
  Invoice,
  RolePermission,
  Role,
  Referral,
  Reward,
  UserReward,
};

// Add ownership to every HR model, including implicit many-to-many join models.
// Column nullability remains migration-controlled during the additive rollout.
const { DataTypes } = require('sequelize');
const { TENANT_TABLES } = require('../services/tenancyInventory');
for (const model of Object.values(User.sequelize.models)) {
  if (!TENANT_TABLES.includes(model.tableName)) continue;
  model.rawAttributes.organization_id = { type: DataTypes.UUID, allowNull: true };
  for (const [field, attribute] of Object.entries(model.rawAttributes)) {
    if (attribute.unique && !attribute.primaryKey) {
      attribute.unique = false;
      model.options.indexes.push({ name: `${model.tableName}_${field}_tenant_unique`, unique: true, fields: ['organization_id', field] });
    }
  }
  for (const index of model.options.indexes) if (index.unique && !index.fields.includes('organization_id')) index.fields = ['organization_id', ...index.fields];
  model.uniqueKeys = {};
  model.refreshAttributes();
}
const Organization = require('./Organization');
const OrganizationMembership = require('./OrganizationMembership');
const HRProfile = require('./HRProfile');
Organization.hasMany(OrganizationMembership, { foreignKey: 'organization_id', as: 'memberships', onDelete: 'RESTRICT' });
OrganizationMembership.belongsTo(Organization, { foreignKey: 'organization_id', as: 'organization' });
User.hasMany(OrganizationMembership, { foreignKey: 'user_id', as: 'organization_memberships', onDelete: 'RESTRICT' });
OrganizationMembership.belongsTo(User, { foreignKey: 'user_id', as: 'user' });
OrganizationMembership.hasOne(HRProfile, { foreignKey: 'membership_id', as: 'hr_profile', onDelete: 'RESTRICT' });
HRProfile.belongsTo(OrganizationMembership, { foreignKey: 'membership_id', as: 'membership' });
HRProfile.belongsTo(Role, { foreignKey: 'role_id', as: 'role', onDelete: 'RESTRICT' });
Object.assign(module.exports, { Organization, OrganizationMembership, HRProfile });
const AuthSession = require('./AuthSession');
Object.assign(module.exports, { AuthSession, AuthRefreshToken: User.sequelize.models.AuthRefreshToken, AuthLegacyExchange: User.sequelize.models.AuthLegacyExchange, AuthSecurityState: User.sequelize.models.AuthSecurityState, AuthOAuthAttempt: User.sequelize.models.AuthOAuthAttempt });
