const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
    // const user = await User.findOne({ username });
    // console.log(user);
    console.log(username, password);
    if (username === 'testuser' && password === 'password123') {
        const token = jwt.sign(
          { username },
          process.env.JWT_SECRET || 'dev_secret',
          { expiresIn: '1d' }
        );
        res.json({ token });
    }else {
        return res.status(400).json({ message: 'Invalid credentials' });
    }
    } catch (error) {
        // console.log('Login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// For first time, create an admin user (remove in production)
router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    const user = new User({ username, password });
    await user.save();
    res.json({ message: 'User registered' });
});

module.exports = router;