// Models
const User = require("./User");
const Engineer = require("./Engineer");
const ProjectManager = require("./ProjectManager");
const Admin = require("./Admin");
const Job = require("./Job");
const Application = require("./Application");
const Project = require("./Project");
const Interview = require("./Interview");
const Chat = require("./Chat");
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
const { Referral } = require("./Referral");
const { Reward } = require("./Reward");
const { UserReward  } = require("./UserReward");

/* =========================
   USER ↔ ROLE RELATIONSHIPS
   ========================= */

// User - Engineer (One-to-One)
User.hasOne(Engineer, {
  foreignKey: "user_id",
  as: "engineer",
  onDelete: "CASCADE",
  onUpdate: "CASCADE",
});
Engineer.belongsTo(User, { foreignKey: "user_id", as: "user" });

// Engineer vetted by Admin(User) (Many-to-One)
Engineer.belongsTo(User, {
  foreignKey: "vetted_by",
  as: "vettedBy",
  onDelete: "SET NULL",
});
User.hasMany(Engineer, {
  foreignKey: "vetted_by",
  as: "vettedEngineers",
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

Department.hasMany(User, {
  foreignKey: "department_id",
  as: "members",
  onDelete: "SET NULL",
});
User.belongsTo(Department, {
  foreignKey: "department_id",
  as: "department",
  onDelete: "SET NULL",
});

User.belongsTo(User, {
  foreignKey: "reports_to_user_id",
  as: "reporting_manager",
  onDelete: "SET NULL",
});
User.hasMany(User, {
  foreignKey: "reports_to_user_id",
  as: "direct_reports",
  onDelete: "SET NULL",
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

// Engineer - Application (One-to-Many)
// 🔧 FIXED: Application MUST belong to Engineer, not User
Engineer.hasMany(Application, {
  foreignKey: "engineer_id",
  as: "applications",
  onDelete: "CASCADE",
});
Application.belongsTo(Engineer, {
  foreignKey: "engineer_id",
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

// Project ↔ Engineer (Many-to-Many)
Engineer.belongsToMany(Project, {
  through: "engineer_project",
  as: "engineer_projects",
  foreignKey: "engineer_id",
  otherKey: "projects_id",
});
Project.belongsToMany(Engineer, {
  through: "engineer_project",
  as: "engineers",
  foreignKey: "projects_id",
  otherKey: "engineer_id",
});

/* =========================
   INTERVIEWS
   ========================= */

Interview.belongsTo(Engineer, {
  as: "candidate",
  foreignKey: "candidate_id",
  targetKey: "engineer_id",
  onDelete: "CASCADE",
});
Engineer.hasMany(Interview, {
  as: "interviews",
  foreignKey: "candidate_id",
  sourceKey: "engineer_id",
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
  User,
  Engineer,
  ProjectManager,
  Admin,
  Job,
  Application,
  Project,
  Interview,
  Chat,
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
  Referral,
  Reward,
  UserReward,
};
