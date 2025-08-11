const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const User = require('./models/User');

const app = express();
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://fe-face-verification-app.onrender.com',
  'http://localhost:3000'
].filter(Boolean);

// app.use(cors({
//   origin: function (origin, callback) {
//     // Allow requests with no origin (like mobile apps or curl)
//     if (!origin) return callback(null, true);
//     if (allowedOrigins.indexOf(origin) === -1) {
//       const msg = "The CORS policy for this site does not allow access from the specified Origin.";
//       return callback(new Error(msg), false);
//     }
//     return callback(null, true);
//   },
//   credentials: true
// }));

// app.use(cors({
//   // origin: 'https://fe-face-verification-app.onrender.com',
//   origin: 'http://localhost:3000',
//   credentials: true
// }))

// server.js
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true
}));


// Basic request logger to help debug 404s in production
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(express.json());
// Ensure uploads directory exists for disk storage
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use('/uploads', express.static(uploadsDir));


// Import routes
const authRoutes = require('./routes/auth');
const schoolRoutes = require('./routes/school');
const studentRoutes = require('./routes/student');
const verificationRoutes = require('./routes/verification');

// Prefer /api/* but also mount non-prefixed for resiliency
app.use('/api/auth', authRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/auth', authRoutes);
app.use('/school', schoolRoutes);
app.use('/student', studentRoutes);
app.use('/verification', verificationRoutes);

app.get('/health', (req, res) => res.json({ ok: true }));

// Removed non-existent upload route


const PORT = process.env.PORT || 5000;

// Start server immediately; connect to DB in background to avoid 404 due to startup failures
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

mongoose
  .connect(process.env.MONGO_URL)
  .then(async () => {
    console.log('Connected to MongoDB');
    try {
      const adminUsername = process.env.ADMIN_USERNAME;
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (adminUsername && adminPassword) {
        const existing = await User.findOne({ username: adminUsername });
        if (!existing) {
          const admin = new User({ username: adminUsername, password: adminPassword });
          await admin.save();
          console.log('Default admin user created');
        } else {
          console.log('Default admin already exists');
        }
      }
    } catch (seedErr) {
      console.error('Error seeding admin user:', seedErr);
    }
  })
  .catch((err) => console.error('MongoDB connection error:', err.message));

// 404 handler to make errors explicit
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found', path: req.originalUrl });
});