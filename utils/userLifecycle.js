const models = require("../models");
const {
  User,
  Project,
  ProjectManager,
  Talent,
  Admin,
  Application,
  Interview,
  Chat,
  ChatUserState,
  Message,
  Notification,
  NotificationBroadcast,
  AuditLog,
} = models;
const sequelize = require("../config/database");
const { getRoleKey, requireDirectoryTarget } = require("./roleUtils");
const { lockHierarchy } = require("./reporting");
const { recordAudit } = require("./audit");
const { afterCommit, disconnectUser } = require("./events");

function quoteTable(model) {
  return sequelize.getQueryInterface().queryGenerator.quoteTable(model.getTableName());
}

function quoteColumn(model, attribute) {
  const field = model.rawAttributes[attribute]?.field || attribute;
  return sequelize.getQueryInterface().queryGenerator.quoteIdentifier(field);
}

async function setNullWhere(model, attribute, id, transaction) {
  const column = quoteColumn(model, attribute);
  await sequelize.query(
    `UPDATE ${quoteTable(model)} SET ${column} = NULL WHERE ${column} = :userId`,
    { replacements: { userId: id }, transaction },
  );
}

async function deleteWhere(model, attribute, id, transaction) {
  const column = quoteColumn(model, attribute);
  await sequelize.query(
    `DELETE FROM ${quoteTable(model)} WHERE ${column} = :userId`,
    { replacements: { userId: id }, transaction },
  );
}

async function permanentlyDeleteUser(id, actor) {
  if (require('../services/tenantContext').peekTenantContext() || process.env.TENANCY_ENFORCED === 'true') return tenantLifecycle(id, actor, false, 'user.membership_remove');
  return sequelize.transaction(async (transaction) => {
    await lockHierarchy(transaction);
    const user = await User.findByPk(id, {
      paranoid: false,
      transaction,
      lock: { level: transaction.LOCK.UPDATE, of: User },
    });
    requireDirectoryTarget(user);
    if (user.user_id === actor.user_id) {
      throw Object.assign(new Error("You cannot permanently delete your own account"), { status: 409 });
    }

    const talent = await Talent.findOne({ where: { user_id: id }, attributes: ["talent_id"], transaction });
    const projectManager = await ProjectManager.findOne({
      where: { user_id: id },
      attributes: ["project_managers_id"],
      transaction,
    });

    if (talent) {
      await setNullWhere(Application, "talent_id", talent.talent_id, transaction);
      await setNullWhere(Interview, "candidate_id", talent.talent_id, transaction);
      const talentProjects = Project.associations.talents.through.model;
      await deleteWhere(talentProjects, "talent_id", talent.talent_id, transaction);
    }
    if (projectManager) {
      await setNullWhere(Project, "project_managers_id", projectManager.project_managers_id, transaction);
      await setNullWhere(Interview, "interviewer_id", projectManager.project_managers_id, transaction);
    }

    const profileModels = new Set([Admin, ProjectManager, Talent]);
    const excludedFields = new Set([
      "Admin.user_id",
      "ProjectManager.user_id",
      "Talent.user_id",
      "Notification.user_id",
    ]);
    const cleared = new Set();
    for (const model of Object.values(models)) {
      if (!model?.associations) continue;
      for (const association of Object.values(model.associations)) {
        if (association.associationType !== "BelongsTo" || association.target !== User) continue;
        const attribute = association.foreignKey;
        const key = `${model.name}.${attribute}`;
        if (excludedFields.has(key) || cleared.has(key)) continue;
        if (!model.rawAttributes[attribute]?.allowNull) {
          if (!await model.unscoped().count({ where: { [attribute]: id }, paranoid: false, transaction })) continue;
          throw new Error(`Cannot unlink required user relationship ${key}`);
        }
        await setNullWhere(model, attribute, id, transaction);
        cleared.add(key);
      }
    }

    const explicitLinks = [
      [User, "referred_by"],
      [User, "deleted_by_user_id"],
      [Project, "created_by_user_id"],
      [NotificationBroadcast, "created_by"],
      [AuditLog, "actor_user_id"],
    ];
    for (const [model, attribute] of explicitLinks) {
      const key = `${model.name}.${attribute}`;
      if (cleared.has(key)) continue;
      await setNullWhere(model, attribute, id, transaction);
      cleared.add(key);
    }

    const chatMembership = Chat.associations.chat_users.through.model;
    await deleteWhere(chatMembership, "user_id", id, transaction);

    const chatsTable = quoteTable(Chat);
    const messagesTable = quoteTable(Message);
    const participants = quoteColumn(Chat, "participants");
    const unreadCounts = quoteColumn(Chat, "unread_counts");
    const createdBy = quoteColumn(Chat, "created_by");
    const lastSender = quoteColumn(Chat, "last_message_sender_id");
    const readBy = quoteColumn(Message, "read_by");
    await sequelize.query(
      `UPDATE ${chatsTable}
       SET ${participants} = array_remove(${participants}, CAST(:userId AS uuid)),
           ${unreadCounts} = COALESCE(${unreadCounts}, '{}'::jsonb) - :userId,
           ${createdBy} = CASE WHEN ${createdBy} = CAST(:userId AS uuid) THEN NULL ELSE ${createdBy} END,
           ${lastSender} = CASE WHEN ${lastSender} = CAST(:userId AS uuid) THEN NULL ELSE ${lastSender} END
       WHERE CAST(:userId AS uuid) = ANY(${participants})
          OR ${unreadCounts} ? :userId
          OR ${createdBy} = CAST(:userId AS uuid)
          OR ${lastSender} = CAST(:userId AS uuid)`,
      { replacements: { userId: id }, transaction },
    );
    await sequelize.query(
      `UPDATE ${messagesTable}
       SET ${readBy} = COALESCE(${readBy}, '{}'::jsonb) - :userId
       WHERE ${readBy} ? :userId`,
      { replacements: { userId: id }, transaction },
    );

    await deleteWhere(ChatUserState, "user_id", id, transaction);
    await deleteWhere(Notification, "user_id", id, transaction);
    for (const model of profileModels) await deleteWhere(model, "user_id", id, transaction);

    await user.destroy({ force: true, transaction, audit: false });
    await recordAudit({
      action: "user.permanent_delete",
      target_type: "User",
      target_id: id,
      actor,
    }, transaction);
    afterCommit(transaction, () => disconnectUser(id));
    return { user_id: id };
  });
}

async function deleteUser(id, actor) {
  if (require('../services/tenantContext').peekTenantContext() || process.env.TENANCY_ENFORCED === 'true') return tenantLifecycle(id, actor, false, 'user.soft_delete');
  return sequelize.transaction(async (transaction) => {
    await lockHierarchy(transaction);
    const user = await User.findByPk(id, { transaction, lock: { level: transaction.LOCK.UPDATE, of: User } });
    requireDirectoryTarget(user);
    if (user.user_id === actor.user_id) throw Object.assign(new Error("You cannot delete your own account"), { status: 409 });
    if (getRoleKey(user) === "super_admin") throw Object.assign(new Error("The sole Super Admin cannot be deleted"), { status: 409 });
    await user.update({ deleted_by_user_id: actor.user_id, session_version: user.session_version + 1 }, { transaction });
    await user.destroy({ transaction, audit: false });
    await recordAudit({ action: "user.soft_delete", target_type: "User", target_id: id, actor }, transaction);
    afterCommit(transaction, () => disconnectUser(id));
    return user;
  });
}
async function restoreUser(id, actor) {
  if (require('../services/tenantContext').peekTenantContext() || process.env.TENANCY_ENFORCED === 'true') return tenantLifecycle(id, actor, true, 'user.restore');
  return sequelize.transaction(async (transaction) => {
    await lockHierarchy(transaction);
    const user = await User.findByPk(id, { paranoid: false, transaction, lock: { level: transaction.LOCK.UPDATE, of: User } });
    requireDirectoryTarget(user);
    if (!user.deleted_at) throw Object.assign(new Error("This account is not deleted"), { status: 409 });
    await user.restore({ transaction, audit: false });
    await user.update({ deleted_by_user_id: null }, { transaction });
    await recordAudit({ action: "user.restore", target_type: "User", target_id: id, actor }, transaction);
    return user;
  });
}
module.exports = { deleteUser, permanentlyDeleteUser, restoreUser };

async function tenantLifecycle(id, actor, restore, action) {
  return sequelize.transaction(async (transaction) => {
    const ScopedUser = require('../services/hrModels').User;
    const user = await ScopedUser.findByPk(id, { paranoid: false, transaction });
    requireDirectoryTarget(user);
    if (!restore && user.user_id === actor.user_id) throw Object.assign(new Error('You cannot remove your own membership here'), { status: 409 });
    if (restore && !user.deleted_at) throw Object.assign(new Error('This membership is not removed'), { status: 409 });
    if (restore) await user.restore({ transaction });
    else await user.destroy({ transaction });
    await user.update({ deleted_by_user_id: restore ? null : actor.user_id }, { transaction });
    await recordAudit({ action, target_type: 'User', target_id: id, actor }, transaction);
    return user;
  });
}
