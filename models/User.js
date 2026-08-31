const { Model, DataTypes } = require("sequelize");
const sequelize = require("../config/database");
const bcrypt = require('bcryptjs');

class User extends Model {}

User.init(
  {
    user_id: {
      type: DataTypes.UUID,
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
    },
    email: {
      type: DataTypes.TEXT,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    role: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        isIn: [['super_admin', 'admin', 'project_manager', 'engineer', 'staff']],
      }
    },
    first_name: {
      type: DataTypes.TEXT,
    },
    last_name: {
      type: DataTypes.TEXT,
    },
    phone_number: {
      type: DataTypes.TEXT,
    },
    employee_id: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true,
    },
    department_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    job_title: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    reports_to_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    employment_type: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "full_time",
    },
    hire_date: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    date_of_birth: {
      type: DataTypes.DATEONLY,
      allowNull: true,
    },
    leave_allowance_days: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 20,
    },
    workforce_permissions: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: false,
      defaultValue: [],
    },
    location_sharing_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    location_permission_status: {
      type: DataTypes.TEXT,
      allowNull: false,
      defaultValue: "not_asked",
      validate: { isIn: [["not_asked", "granted", "denied", "unavailable"]] },
    },
    browser_latitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
    },
    browser_longitude: {
      type: DataTypes.DECIMAL(10, 7),
      allowNull: true,
    },
    browser_location_accuracy: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true,
    },
    browser_location_updated_at: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    browser_location_address: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    browser_location_city: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    browser_location_state: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    browser_location_country: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    browser_location_country_code: {
      type: DataTypes.STRING(2),
      allowNull: true,
    },
    current_assignment: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    work_region: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    is_verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    avatar_object_name: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    country: {
      type: DataTypes.TEXT,
    },
    city: {
      type: DataTypes.TEXT,
    },
    linkedin_url: {
      type: DataTypes.TEXT
    },
    website_url: {
      type: DataTypes.TEXT,
    },
    last_login: {
      type: DataTypes.DATE,
    },
    reset_password_token: {
      type: DataTypes.TEXT,
    },
    reset_password_expires: {
      type: DataTypes.DATE,
    },
    referral_code: {
      type: DataTypes.STRING(10),
      unique: true,
    },
    referred_by: {
      type: DataTypes.UUID,
      references: {
        model: 'users',
        key: 'user_id',
      },
    },
    reward: {
      type: DataTypes.DECIMAL(10, 2),
      defaultValue: 0.00,
    },
    created_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: "User",
    tableName: "users",
    timestamps: true, // Sequelize will now handle the timestamps automatically
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    indexes: [
      {
        name: "users_single_super_admin",
        unique: true,
        fields: ["role"],
        where: { role: "super_admin" },
      },
    ],
  }
);

// Hash password before saving
User.beforeCreate(async (user) => {
  if (user.password) {
    user.password = await bcrypt.hash(user.password, 12);
  }
  // Generate unique referral code
  if (!user.referral_code) {
    user.referral_code = generateReferralCode();
  }
});

User.beforeUpdate(async (user) => {
  if (user.changed('password')) {
    user.password = await bcrypt.hash(user.password, 12);
  }
});

// Instance methods
User.prototype.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

User.prototype.toJSON = function() {
  const user = this.get();
  delete user.password;
  delete user.reset_password_token;
  delete user.reset_password_expires;
  return user;
};

// Generate unique referral code
const generateReferralCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

User.addScope('defaultScope', {
  attributes: {
    exclude: ['password', 'reset_password_token', 'reset_password_expires']
  }
}, { override: true });

module.exports = User;
