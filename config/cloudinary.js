// config/cloudinary.js
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

cloudinary.config({
  cloud_name: process.env.dpwdruptp,
  api_key:    process.env.881493931746548,
  api_secret: process.env.tLyoV8mE9GdUeGog4xePkNkiPIw
});

module.exports = cloudinary;
