const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users');
const { authenticateToken } = require('../middleware/jwt');
const ensureDB = require('../middleware/db');

router.use(ensureDB);

// Public - Homepage nearby providers
router.get('/home', usersController.home);

module.exports = router;