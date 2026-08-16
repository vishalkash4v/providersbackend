const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth');
const { authenticateToken } = require('../middleware/jwt');

// ======================= PUBLIC ROUTES =======================

// Register (Customer or Provider)
router.post('/register', authController.register);

// Verify OTP
router.post('/verify-otp', authController.verifyOtp);

// Resend OTP
router.post('/resend-otp', authController.resendOtp);

// Login
router.post('/login', authController.login);

// Forgot Password
router.post('/forgot-password', authController.forgotPassword);

// Reset Password
router.post('/reset-password', authController.resetPassword);

// ======================= PROTECTED ROUTES =======================

// Get Logged In User
router.get('/me', authenticateToken, authController.getMe);

// Change Password
router.post('/change-password', authenticateToken, authController.changePassword);

// Logout
router.post('/logout', authenticateToken, authController.logout);

module.exports = router;