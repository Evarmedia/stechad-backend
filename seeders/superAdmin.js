require("dotenv").config();

const sequelize = require("../config/database");
const { User, Admin } = require("../models");

const email = String(process.env.SUPER_ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.SUPER_ADMIN_PASSWORD || "");
const firstName = String(process.env.SUPER_ADMIN_FIRST_NAME || "Super").trim();
const lastName = String(process.env.SUPER_ADMIN_LAST_NAME || "Admin").trim();

const validateInput = () => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("SUPER_ADMIN_EMAIL must be a valid email address");
  if (password.length < 12) throw new Error("SUPER_ADMIN_PASSWORD must contain at least 12 characters");
};

const seedSuperAdmin = async () => {
  validateInput();
  await sequelize.authenticate();

  const result = await sequelize.transaction(async (transaction) => {
    const existingSuperAdmin = await User.findOne({
      where: { role: "super_admin" },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (existingSuperAdmin) {
      if (existingSuperAdmin.email.toLowerCase() !== email) {
        throw new Error(`A Super Admin already exists (${existingSuperAdmin.email}). Only one is allowed.`);
      }
      const [admin] = await Admin.findOrCreate({
        where: { user_id: existingSuperAdmin.user_id },
        defaults: { user_id: existingSuperAdmin.user_id, is_super_admin: true },
        transaction,
      });
      if (!admin.is_super_admin) await admin.update({ is_super_admin: true }, { transaction });
      return { user: existingSuperAdmin, created: false };
    }

    const userWithEmail = await User.findOne({ where: { email }, transaction });
    if (userWithEmail) throw new Error("SUPER_ADMIN_EMAIL already belongs to a non-Super-Admin account");

    const user = await User.create({
      email,
      password,
      first_name: firstName || "Super",
      last_name: lastName || "Admin",
      role: "super_admin",
      is_verified: true,
      is_active: true,
    }, { transaction });
    await Admin.create({ user_id: user.user_id, is_super_admin: true }, { transaction });
    return { user, created: true };
  });

  console.log(result.created ? `Super Admin created: ${result.user.email}` : `Super Admin already seeded: ${result.user.email}`);
};

seedSuperAdmin()
  .catch((error) => {
    console.error(`Super Admin seed failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
