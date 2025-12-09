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
const { Referral, Reward, UserReward } = require("./Referral");

// Define relationships between models

// User - Engineer (One-to-One)
User.hasOne(Engineer, { foreignKey: 'user_id', as: 'engineer', onDelete: 'CASCADE' });
Engineer.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// Engineer - User(who is an admin that vetted the engineer) (Many-to-One)
Engineer.belongsTo(User, { foreignKey: 'vetted_by', as: 'vettedBy', onDelete: 'SET NULL' });
User.hasMany(Engineer, { foreignKey: 'vetted_by', as: 'vettedEngineers' });

// User - ProjectManager (One-to-One)
User.hasOne(ProjectManager, { foreignKey: 'user_id', as: 'project_manager', onDelete: 'CASCADE' });
ProjectManager.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User - Admin (One-to-One)
User.hasOne(Admin, { foreignKey: 'user_id', as: 'admin', onDelete: 'CASCADE' });
Admin.belongsTo(User, { foreignKey: 'user_id', as: 'user' });

// User - Job (One-to-Many)
User.hasMany(Job, {
  foreignKey: "posted_by",
  as: "poster",
  onDelete: "NO ACTION",
});
Job.belongsTo(User, { foreignKey: 'posted_by', as: 'poster' });

// Job - Application (One-to-Many)
Job.hasMany(Application, { foreignKey: 'job_id', as: 'applications', onDelete: 'NO ACTION', onUpdate: 'CASCADE' });
Application.belongsTo(Job, { foreignKey: 'job_id', as: 'job' });

// Engineer(user) - Application (One-to-Many)
Engineer.hasMany(Application, { foreignKey: 'engineer_id', as: 'applications', onDelete: 'CASCADE' });
Application.belongsTo(User, { foreignKey: 'engineer_id', as: 'applicant' });

// ProjectManager - Project (One-to-Many)
ProjectManager.hasMany(Project, { foreignKey: 'project_managers_id', as: 'pm_projects', onDelete: 'SET NULL' });
Project.belongsTo(ProjectManager, { foreignKey: 'project_managers_id', as: 'project_manager' });

// Job - Project (One-to-Many)
Job.hasMany(Project, { foreignKey: 'job_id', as: 'projects', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Project.belongsTo(Job, { foreignKey: 'job_id', as: 'job' });

// job - ProjectManager (Many-to-One)
// Job.belongsTo(ProjectManager, {
//   foreignKey: "posted_by",
//   as: "postedBy",
//   onDelete: "NO ACTION",
// });
ProjectManager.hasMany(Job, { foreignKey: 'posted_by', as: 'posted_jobs' });

// User - Project (One-to-Many)
User.hasMany(Project, { foreignKey: 'engineer_user_id', onDelete: 'SET NULL', onUpdate: 'CASCADE' });
Project.belongsTo(User, { foreignKey: 'engineer_user_id', as: 'engineer' });
// Project.belongsTo(User, { foreignKey: 'project_managers_user_id', as: 'pm' });

// Engineer - Project (Many-to-Many)
Engineer.belongsToMany(Project, { through: 'engineer_project', as: 'engineer_projects' });
Project.belongsToMany(Engineer, { through: 'engineer_project', as: 'engineers' });

// // Engineer - Interview (One-to-Many)
// Engineer.hasMany(Interview, { foreignKey: 'candidate_id', as: 'interviews', onDelete: 'CASCADE' });
// Interview.belongsTo(Engineer, { foreignKey: 'candidate_id', as: 'candidate' });

// // ProjectManager - Interview (One-to-Many)
// ProjectManager.hasMany(Interview, { foreignKey: 'interviewer_id', as: 'interviews', onDelete: 'CASCADE' });
// Interview.belongsTo(ProjectManager, { foreignKey: 'interviewer_id', as: 'interviewer' });

// // Job - Interview (One-to-Many)
// Job.hasMany(Interview, { foreignKey: 'job_id', as: 'interviews', onDelete: 'CASCADE' });
// Interview.belongsTo(Job, { foreignKey: 'job_id', as: 'job' });

Interview.belongsTo(Engineer,       { as: 'candidate',        foreignKey: 'candidate_id',    targetKey: 'engineer_id', onDelete: 'CASCADE' });
Interview.belongsTo(ProjectManager, { as: 'interviewer',  foreignKey: 'interviewer_id',  targetKey: 'project_managers_id', onDelete: 'CASCADE' });
Interview.belongsTo(Job,            { as: 'job',              foreignKey: 'job_id',          targetKey: 'jobs_id' });

Engineer.hasMany(Interview,       { as: 'interviews',       foreignKey: 'candidate_id',   sourceKey: 'engineer_id' });
ProjectManager.hasMany(Interview, { as: 'interviews',       foreignKey: 'interviewer_id', sourceKey: 'project_managers_id' });
Job.hasMany(Interview,            { as: 'interviews',       foreignKey: 'job_id',         sourceKey: 'jobs_id' });

// User - Chat (Many-to-Many via ChatParticipants)
User.belongsToMany(Chat, { through: "ChatParticipants", foreignKey: "user_id", as: 'user_chats' });
Chat.belongsToMany(User, { through: "ChatParticipants", foreignKey: "chat_id", as: 'chat_users' });

// Chat - Message (One-to-Many)
Chat.hasMany(Message, { foreignKey: 'chat_id', as: 'messages', onDelete: 'CASCADE' });
Message.belongsTo(Chat, { foreignKey: 'chat_id', as: 'chat' });

// User - Message (One-to-Many)
User.hasMany(Message, { foreignKey: 'sender_id', as: 'sent_messages', onDelete: 'CASCADE' });
Message.belongsTo(User, { foreignKey: 'sender_id', as: 'sender' });

// User - Notification (One-to-Many)
User.hasMany(Notification, { foreignKey: 'user_id', as: 'notifications', onDelete: 'CASCADE' });
Notification.belongsTo(User, { foreignKey: 'user_id', as: 'user_notifications' });

// User model relationships
User.hasMany(Referral, { foreignKey: 'referrer_id', as: 'referralsMade' });
User.hasMany(Referral, { foreignKey: 'referee_id', as: 'referralsReceived' });
User.belongsTo(User, { foreignKey: 'referrer_id', as: 'referrer', onDelete: 'SET NULL' });
User.hasMany(User, { foreignKey: 'referred_by', as: 'referees' });

// Referral to User (Many-to-One)
Referral.belongsTo(User, { foreignKey: 'referrer_id', as: 'referrer', onDelete: 'CASCADE' });
Referral.belongsTo(User, { foreignKey: 'referee_id', as: 'referee', onDelete: 'CASCADE' });

// user - Invite (One-to-Many)
User.hasMany(Invite, { foreignKey: 'invited_by_user_id', as: 'sent_invites', onDelete: 'CASCADE' });
Invite.belongsTo(User, { foreignKey: 'invited_by_user_id', as: 'inviter' });

// Reward - UserReward (Many-to-Many via UserReward table)
Reward.hasMany(UserReward, { foreignKey: 'reward_id', onDelete: 'CASCADE' });
UserReward.belongsTo(Reward, { foreignKey: 'reward_id' });

User.hasMany(UserReward, { foreignKey: 'user_id', onDelete: 'CASCADE' });
UserReward.belongsTo(User, { foreignKey: 'user_id' });

// Referral - UserReward (One-to-Many)
Referral.hasMany(UserReward, { foreignKey: 'referral_id',  onDelete: 'CASCADE' });
UserReward.belongsTo(Referral, { foreignKey: 'referral_id', as: 'referral', });

// Self-referencing message replies
Message.belongsTo(Message, { foreignKey: 'reply_to', as: 'replyToMessage', onDelete: 'SET NULL' });
Message.hasMany(Message, { foreignKey: 'reply_to', as: 'replies' });

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
  Referral,
  Reward,
  UserReward,
};
