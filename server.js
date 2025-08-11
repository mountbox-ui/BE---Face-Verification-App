const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const path = require('path');

const app = express();
const allowedOrigins = [
  "https://fe-face-verification-app.onrender.com/", // your frontend in production
  "http://localhost:3000/" // for local development
];

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
  origin: process.env.CLIENT_URL || 'https://fe-face-verification-app.onrender.com',
  credentials: true
}));


app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));


// Import routes
const authRoutes = require('./routes/auth');
const schoolRoutes = require('./routes/school');
const studentRoutes = require('./routes/student');
const verificationRoutes = require('./routes/verification');

app.use('/api/auth', authRoutes);
app.use('/api/school', schoolRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/verification', verificationRoutes);

const uploadRoute = require('./routes/upload');
app.use('/api', uploadRoute);


const PORT = process.env.PORT || 5000;


mongoose.connect(process.env.MONGO_URL,)
    .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
    .catch((err) => console.log(err));