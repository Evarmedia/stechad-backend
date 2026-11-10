require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
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
const engineerRoutes = require('./routes/engineerRoutes');
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
app.use(helmet());
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
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpecs, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Stechad Platform API Documentation'
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/engineers', engineerRoutes);
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Server is running' });
});

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Welcome to Stechad Base' });
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
initializeChatSocket(io);

// Database connection and server start
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');

    await migrateRoleStorage();
    console.log('Role storage migrated');
    
    if (process.env.DB_SYNC_ALTER !== "disabled") {
      const alterSchema = process.env.DB_SYNC_ALTER !== "false";

      await sequelize.sync({
        alter: alterSchema,
        force: false,
      });
    }
    console.log('Database synchronized');
    // Reconcile once more so fresh databases created by sync receive the same
    // role foreign keys, indexes, and system-role seed as upgraded databases.
    await migrateRoleStorage();
    console.log('Role storage verified');

    // Create default rewards if they don't exist
    const existingRewards = await Reward.count();
    if (existingRewards === 0) {
      await createDefaultRewards();
    }
    startHolidayNotificationScheduler();
    startAttendanceCloseScheduler();
    
    server.listen(PORT, () => {
      console.log(`Running in ${process.env.NODE_ENV} mode`)
      console.log(`👀Server running on port ${PORT}`);
      console.log(`🖥️ API docs at http://localhost:${PORT}/api-docs`);
    });
  } catch (error) {
    console.error('Unable to start server:', error);
    process.exit(1);
  }
};

startServer();
