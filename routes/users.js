const express = require('express');
const router = express.Router();
const usersController = require('../controllers/users');
const ensureDB = require('../middleware/db');

router.use(ensureDB);

// Public - Homepage nearby providers
router.get('/nearby-providers', usersController.getNearbyProviders);

module.exports = router;