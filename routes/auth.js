const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    // Optional test login for demo environments
    if (
      process.env.ALLOW_TEST_LOGIN === 'true' &&
      username === 'testuser' &&
      password === 'password123'
    ) {
      const token = jwt.sign(
        { username: 'testuser', demo: true },
        process.env.JWT_SECRET || 'dev_secret',
        { expiresIn: '1d' }
      );
      return res.json({ token });
    }

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '1d' }
    );
    res.json({ token });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// For first time, create an admin user (remove in production)
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }
    const existing = await User.findOne({ username });
    if (existing) {
      return res.status(400).json({ message: 'Username already exists' });
    }
    const user = new User({ username, password });
    await user.save();
    res.json({ message: 'User registered' });
  } catch (err) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;