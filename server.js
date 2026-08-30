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

// WebSocket handling for real-time chat
const jwt = require('jsonwebtoken');
const { User } = require('./models');
const { sendMessage, markMessagesAsRead } = require('./utils/chatUtil');

// Socket authentication middleware
const authenticateSocket = async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication error'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(decoded.user_id);
    
    if (!user || !user.is_active) {
      return next(new Error('Authentication error'));
    }

    socket.userId = user.user_id;
    socket.user = user;
    next();
  } catch (error) {
    next(new Error('Authentication error'));
  }
};

io.use(authenticateSocket);

// Connected users tracking
const connectedUsers = new Map();

io.on('connection', (socket) => {
  console.log(`User ${socket.user.first_name} connected: ${socket.id}`);
  
  // Track connected user
  connectedUsers.set(socket.userId, {
    socketId: socket.id,
    user: socket.user,
    lastSeen: new Date()
  });

  // Join user to their personal room
  socket.join(`user_${socket.userId}`);

  // Broadcast user online status
  socket.broadcast.emit('user_online', {
    user_id: socket.userId,
    user: {
      first_name: socket.user.first_name,
      last_name: socket.user.last_name,
      avatar_url: socket.user.avatar_url
    }
  });

  // Join chat rooms
  socket.on('join_chat', (chatId) => {
    socket.join(`chat_${chatId}`);
    console.log(`User ${socket.userId} joined chat ${chatId}`);
  });

  // Leave chat rooms
  socket.on('leave_chat', (chatId) => {
    socket.leave(`chat_${chatId}`);
    console.log(`User ${socket.userId} left chat ${chatId}`);
  });

  // Handle sending messages
  socket.on('send_message', async (data) => {
    try {
      const { chat_id, content, message_type = 'text', attachments = [], reply_to } = data;
      
      const message = await sendMessage(
        chat_id,
        socket.userId,
        content,
        message_type,
        attachments,
        reply_to
      );

      // Emit message to all users in the chat
      io.to(`chat_${chat_id}`).emit('new_message', {
        message,
        chat_id
      });

      // Send acknowledgment to sender
      socket.emit('message_sent', {
        success: true,
        message
      });

    } catch (error) {
      socket.emit('message_error', {
        success: false,
        error: error.message
      });
    }
  });

  // Handle typing indicators
  socket.on('typing_start', (data) => {
    socket.to(`chat_${data.chat_id}`).emit('user_typing', {
      user_id: socket.userId,
      user_name: `${socket.user.first_name} ${socket.user.last_name}`,
      chat_id: data.chat_id
    });
  });

  socket.on('typing_stop', (data) => {
    socket.to(`chat_${data.chat_id}`).emit('user_stopped_typing', {
      user_id: socket.userId,
      chat_id: data.chat_id
    });
  });

  // Handle message read receipts
  socket.on('mark_messages_read', async (data) => {
    try {
      const { chat_id, message_ids = [] } = data;
      
      await markMessagesAsRead(chat_id, socket.userId, message_ids);
      
      // Notify other users in chat about read status
      socket.to(`chat_${chat_id}`).emit('messages_read', {
        user_id: socket.userId,
        chat_id,
        message_ids
      });

    } catch (error) {
      socket.emit('read_error', {
        success: false,
        error: error.message
      });
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`User ${socket.user.first_name} disconnected: ${socket.id}`);
    
    // Remove from connected users
    connectedUsers.delete(socket.userId);
    
    // Broadcast user offline status
    socket.broadcast.emit('user_offline', {
      user_id: socket.userId,
      last_seen: new Date()
    });
  });

  // Get online users
  socket.on('get_online_users', () => {
    const onlineUsers = Array.from(connectedUsers.values()).map(userData => ({
      user_id: userData.user.user_id,
      first_name: userData.user.first_name,
      last_name: userData.user.last_name,
      avatar_url: userData.user.avatar_url,
      last_seen: userData.lastSeen
    }));
    
    socket.emit('online_users', onlineUsers);
  });
});

// Database connection and server start
const startServer = async () => {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');
    
    const alterSchema = process.env.DB_SYNC_ALTER !== 'false';
    await sequelize.sync({ alter: alterSchema, force: false });
    console.log('Database synchronized');

    // Create default rewards if they don't exist
    const existingRewards = await Reward.count();
    if (existingRewards === 0) {
      await createDefaultRewards();
    }
    startHolidayNotificationScheduler();
    
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
