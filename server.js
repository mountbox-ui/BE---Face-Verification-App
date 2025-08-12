const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Initialize Express app
const app = express();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Middleware to set CORS headers manually (for debugging)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  // Do not set Access-Control-Allow-Credentials with wildcard origin
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Serve static files from uploads directory
app.use('/uploads', express.static(uploadsDir));

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Route imports
const authRoutes = require('./routes/auth');
const schoolRoutes = require('./routes/school');
const studentRoutes = require('./routes/student');
const verificationRoutes = require('./routes/verification');
const uploadRoutes = require('./routes/upload');

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/upload', uploadRoutes);

// Root route for testing
app.get('/', (req, res) => {
  res.json({
    message: 'Face Verification API is running',
    version: '1.00',
    endpoints: [
      '/api/auth',
      '/api/school',
      '/api/student',
      '/api/verification',
      '/api/upload'
    ]
  });
});

// 404 handler for undefined routes
app.use('/*catchall', (req, res) => {
  res.status(404).json({
    message: 'Route not found',
    path: req.originalUrl
  });
});

// Global error handling middleware (must be last)
app.use((err, req, res, next) => {
  console.error('Global Error Handler:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    timestamp: new Date().toISOString()
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    ...(isDevelopment && { stack: err.stack })
  });
});

// Database connection and server start
const PORT = process.env.PORT || 5000;
const MONGO_URL = process.env.MONGO_URL || process.env.MONGODB_URI;

if (!MONGO_URL) {
  console.error('❌ MongoDB connection string not found in environment variables');
  console.error('Please set MONGO_URL or MONGODB_URI in your .env file');
  process.exit(1);
}

// Connect to MongoDB
mongoose.connect(MONGO_URL, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB');

  // Start server only after successful database connection
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📁 Uploads directory: ${uploadsDir}`);

    if (process.env.NODE_ENV === 'development') {
      console.log(`🔗 Local URL: http://localhost:${PORT}`);
      console.log(`📋 API Documentation: http://localhost:${PORT}/`);
    }
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
      mongoose.connection.close();
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
      mongoose.connection.close();
      process.exit(0);
    });
  });
})
.catch((err) => {
  console.error('❌ MongoDB connection error:', err.message);
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Do not exit; keep server alive
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // Do not exit immediately; allow process manager to decide
});

module.exports = app;