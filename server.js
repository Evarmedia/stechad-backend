require('dotenv').config();
// Runtime HR access is always tenant-bound; legacy compatibility is test-only.
process.env.TENANCY_ENFORCED = 'true';
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const Sequelize = require('sequelize');
const Umzug = require('umzug');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const swaggerSpecs = require('./config/swagger');
const createDefaultRewards = require('./seeders/referralRewards');
const PORT = process.env.PORT || 5000;

const sequelize = require('./config/database');
const { Reward } = require('./models');
const authRoutes = require('./routes/authRoutes');
const talentRoutes = require('./routes/talentRoutes');
const pmRoutes = require('./routes/pmRoutes');
const adminRoutes = require('./routes/adminRoutes');
const jobsRoutes = require('./routes/jobsRoutes');
const applicationRoutes = require('./routes/applicationRoutes');
const projectRoutes = require('./routes/projectRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const exportRoutes = require('./routes/exportRoutes');
const referralRoutes = require('./routes/referralRoutes');
const chatRoutes = require('./routes/chatRoutes');
const interviewRoutes = require('./routes/interviewRoutes');
const staffRoutes = require('./routes/staffRoutes');
const { startHolidayNotificationScheduler } = require('./utils/holidayNotifications');
const { startAttendanceCloseScheduler } = require('./utils/attendanceScheduler');
const { migrateRoleStorage } = require('./utils/roleMigration');
const { migrateChatStorage } = require('./utils/chatMigration');

const migrationRunner = new Umzug({
  migrations: {
    path: path.join(__dirname, 'migrations'),
    pattern: /^\d+.*\.js$/,
    params: [sequelize.getQueryInterface(), Sequelize],
  },
  storage: 'sequelize',
  storageOptions: {
    sequelize,
    tableName: 'SequelizeMeta',
    schema: sequelize.schema || sequelize.options.schema || 'public',
  },
  logging: false,
});


const passport = require('passport');
// const session = require('express-session');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
});

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.FRONTEND_PROD_URL,
  process.env.BACKEND_URL,
  process.env.BACKEND_PROD_URL,
  process.env.RENDER_EXTERNAL_URL, // Render injects this in production
].filter(Boolean);

const corsOptions = {
  // Allow same-origin, Postman (no origin), and any explicitly whitelisted origins
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some((allowedOrigin) => origin.startsWith(allowedOrigin));
    return allowed
      ? callback(null, true)
      : callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
};

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "script-src": ["'self'", "https://cdn.jsdelivr.net"],
        "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      },
    },
  }),
);

app.use(cors(corsOptions));
app.use(compression());
// Trust the proxy to correctly handle X-Forwarded-For headers
app.set('trust proxy', false);

// Rate limiting
const limiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 1000, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

// Body parsing middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Logging middleware
// if (process.env.NODE_ENV === 'development') {
//   app.use(morgan('dev'));
// }

app.use(passport.initialize());

// Swagger documentation
const swaggerCdn = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.34.1';

app.use(
  '/api-docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpecs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Stechad Platform API Documentation',
    customCssUrl: `${swaggerCdn}/swagger-ui.css`,
    customJs: [
      `${swaggerCdn}/swagger-ui-bundle.js`,
      `${swaggerCdn}/swagger-ui-standalone-preset.js`,
    ],
  })
);

// Serverless exports do not run startServer. Verify the migration before their
// first request too; failed verification stays closed and may be retried.
let serverlessReadiness;
if (process.env.VERCEL) app.use(async (req, res, next) => {
  try {
    serverlessReadiness ||= require('./services/tenancyReadiness').assertTenancyReady(sequelize).then(() => installAuditing(require('./models'))).catch((error) => { serverlessReadiness = undefined; throw error; });
    await serverlessReadiness;
    next();
  } catch (error) {
    console.error('Tenancy readiness failed:', error.message);
    res.status(503).json({ success: false, message: 'Organization storage is not ready' });
  }
});
const { auditContext, installAuditing } = require("./utils/audit");
app.use("/api", auditContext);
// Routes
app.use('/api/auth', authRoutes);
app.use('/api/organizations', require('./routes/organizationRoutes'));
app.use('/api/talents', talentRoutes);
app.use('/api/pm', pmRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/jobs', jobsRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/workforce/management', require('./routes/managementRoutes'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Welcome to Stechad Base' });
});

app.get("/api-docs.json", (req, res) => {
  res.json(swaggerSpecs);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  console.log("Route not found");
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Share the same authenticated event delivery with REST chat endpoints.
const { initializeChatSocket } = require('./utils/chatSocket');
app.set('io', io);
require('./utils/events').setRealtime(io);
initializeChatSocket(io);

// Database initialization
const initializeDatabase = async () => {
  await sequelize.authenticate();
  console.log('Database connected successfully');

  await migrateRoleStorage();
  console.log('Role storage migrated');

  await migrateChatStorage();

  await migrationRunner.up();
  console.log('Migration completed');
  installAuditing(require('./models'));

  await migrateChatStorage();
  await migrateRoleStorage();
  console.log('Role storage verified');

  await require('./services/tenancyReadiness').assertTenancyReady(sequelize);
  const { STECHAD_ORGANIZATION_ID } = require('./services/tenancyInventory');
  const existingRewards = await Reward.count({ where: { organization_id: STECHAD_ORGANIZATION_ID } });

  if (existingRewards === 0) {
    await createDefaultRewards();
  }
};

// Traditional server startup
const startServer = async () => {
  try {
    await initializeDatabase();

    startHolidayNotificationScheduler();
    startAttendanceCloseScheduler();

    server.listen(PORT, () => {
      console.log(`Running in ${process.env.NODE_ENV} mode`);
      console.log(`Server running on port ${PORT}`);
      console.log(`API docs at http://localhost:${PORT}/api-docs`);
    });

  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
};

// Start only when running as a standalone Node.js server
if (!process.env.VERCEL && require.main === module) {
  startServer();
}

// Export HTTP server for Vercel
module.exports = server;