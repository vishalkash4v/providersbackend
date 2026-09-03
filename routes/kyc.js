const express = require('express');
const router = express.Router();
const kyc = require('../controllers/kyc');
const { authenticateToken } = require('../middleware/jwt');

router.post('/submit', authenticateToken, kyc.submitKyc);
router.put('/review/:kycId', authenticateToken, kyc.reviewKyc); // Isme Admin middleware bhi laga lena

module.exports = router;