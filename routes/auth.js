const express = require('express');
const router = express.Router();
// const jwt = require('jsonwebtoken'); // Removed JWT
// const bcrypt = require('bcryptjs'); // Removed bcrypt
// const User = require('../models/User'); // User model no longer needed for bypassed auth

// Simplified Login route to bypass authentication
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Check for specific hardcoded credentials
    if (username === 'admin' && password === 'admin123') {
      return res.json({
        message: 'Login successful',
        token: 'mock-admin-token', // Provide a mock token for admin
        user: {
          id: 'admin-user-id',
          username: 'admin'
        }
      });
    } else {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

module.exports = router;