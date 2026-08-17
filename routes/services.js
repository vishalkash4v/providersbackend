const express = require('express');
const router = express.Router();
const servicesController = require('../controllers/services');
const { authenticateToken } = require('../middleware/jwt');
const ensureDB = require('../middleware/db');

router.use(ensureDB);

// Public
router.get('/active', servicesController.getActiveServices);

// Protected
router.post('/add', authenticateToken, servicesController.addService);
router.get('/all', authenticateToken, servicesController.getAllServices);
router.put('/update/:id', authenticateToken, servicesController.updateService);
router.patch('/toggle/:id', authenticateToken, servicesController.toggleServiceStatus);
router.delete('/delete/:id', authenticateToken, servicesController.deleteService);

module.exports = router;