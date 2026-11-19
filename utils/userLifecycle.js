const { Op } = require("sequelize");
const { User, Department, Project, ProjectManager, Talent } = require("../models");
const sequelize = require("../config/database");
const { getRoleKey, requireDirectoryTarget } = require("./roleUtils");
const { lockHierarchy } = require("./reporting");
const { recordAudit } = require("./audit");
const { afterCommit, disconnectUser } = require("./events");
const activeStatuses = ["planning", "in_progress", "on_hold"];
async function deleteUser(id, actor) {
  return sequelize.transaction(async (transaction) => {
    await lockHierarchy(transaction);
    const user = await User.findByPk(id, { transaction, lock: { level: transaction.LOCK.UPDATE, of: User } });
    requireDirectoryTarget(user);
    if (user.user_id === actor.user_id) throw Object.assign(new Error("You cannot delete your own account"), { status: 409 });
    if (getRoleKey(user) === "super_admin") throw Object.assign(new Error("The sole Super Admin cannot be deleted"), { status: 409 });
    const departments = await Department.findAll({ where: { manager_user_id: id, status: "active" }, attributes: ["department_id", "name"], transaction });
    const reports = await User.findAll({ where: { reports_to_user_id: id }, attributes: ["user_id", "first_name", "last_name"], transaction });
    const pm = await ProjectManager.findOne({ where: { user_id: id }, transaction });
    const talent = await Talent.findOne({ where: { user_id: id }, transaction });
    const projects = new Map();
    if (pm) for (const project of await Project.findAll({ where: { project_managers_id: pm.project_managers_id, status: activeStatuses }, attributes: ["projects_id", "title", "status"], transaction })) projects.set(project.projects_id, project);
    if (talent) for (const project of await talent.getTalent_projects({ where: { status: activeStatuses }, attributes: ["projects_id", "title", "status"], transaction })) projects.set(project.projects_id, project);
    if (departments.length || reports.length || projects.size) throw Object.assign(new Error("Reassign department management, direct reports, and active projects before deleting this user"), { status: 409, blockers: { departments, directReports: reports, projects: [...projects.values()] } });
    await user.update({ deleted_by_user_id: actor.user_id, session_version: user.session_version + 1 }, { transaction });
    await user.destroy({ transaction, audit: false });
    await recordAudit({ action: "user.soft_delete", target_type: "User", target_id: id, actor }, transaction);
    afterCommit(transaction, () => disconnectUser(id));
    return user;
  });
}
async function restoreUser(id, actor) {
  return sequelize.transaction(async (transaction) => {
    const user = await User.findByPk(id, { paranoid: false, transaction, lock: { level: transaction.LOCK.UPDATE, of: User } });
    requireDirectoryTarget(user);
    if (!user.deleted_at) throw Object.assign(new Error("This account is not deleted"), { status: 409 });
    await user.restore({ transaction, audit: false });
    await user.update({ deleted_by_user_id: null }, { transaction });
    await recordAudit({ action: "user.restore", target_type: "User", target_id: id, actor }, transaction);
    return user;
  });
}
module.exports = { deleteUser, restoreUser };
