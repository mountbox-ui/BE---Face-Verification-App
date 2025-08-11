const express = require('express');
const router = express.Router();
// Auth disabled for demo: no JWT, no DB lookup

router.post('/login', (req, res) => {
  // Always succeed for demo; return a placeholder value
  res.json({ ok: true });
});

// For first time, create an admin user (remove in production)
router.post('/register', (_req, res) => {
  res.json({ ok: true });
});

module.exports = router;