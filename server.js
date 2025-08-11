const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();
const path = require('path');
const cloudinary = require('./config/cloudinary');

const app = express();
const upload = multer({ dest: 'uploads/' });
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

const uploadRoutes = require('./routes/upload');
app.use('/api', uploadRoutes);

app.post('/api/upload', upload.single('image'), async (req, res) => {
  try {
    const path = req.file.path;
    const result = await cloudinary.uploader.upload(path, {
      folder: 'profile_pictures'
    });
    fs.unlinkSync(path); // Remove file after upload
    res.json({ url: result.secure_url });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed', details: err.message });
  }
});


const PORT = process.env.PORT || 5000;


mongoose.connect(process.env.MONGO_URL,)
    .then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)))
    .catch((err) => console.log(err));