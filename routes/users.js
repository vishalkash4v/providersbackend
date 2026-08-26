const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users');
const { authenticateToken } = require('../middleware/jwt');
const ensureDB = require('../middleware/db');

router.use(ensureDB);

// Public - Homepage nearby providers
router.get('/home', usersController.home);
// Ensure usersController is imported correctly at the top
router.get('/notifications', authenticateToken, usersController.getNotifications);
module.exports = router;