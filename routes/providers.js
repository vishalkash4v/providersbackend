const express = require('express');
const router = express.Router();
const providersController = require('../controllers/providers');
const { authenticateToken } = require('../middleware/jwt');
const ensureDB = require('../middleware/db');

router.use(ensureDB);

// Protected (Provider only)
// Get Provider Dashboard Home (Stats, Offers, Leads)
router.get('/home', authenticateToken, providersController.getProviderHome);
router.post('/work-details', authenticateToken, providersController.addWorkDetails);
router.get('/my-work-details', authenticateToken, providersController.getMyWorkDetails);
router.put('/work-details',authenticateToken,providersController.updateWorkDetails);
module.exports = router;