const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth');
const { authenticateToken } = require('../middleware/jwt');
const ensureDB = require('../middleware/db');

// Apply DB connection middleware to all auth routes
router.use(ensureDB);

// Public routes
router.post('/register', authController.register);
router.post('/update-profile', authenticateToken, authController.updateProfile);
router.post('/verify-otp', authController.verifyOtp);
router.post('/resend-otp', authController.resendOtp);
router.post('/login', authController.login);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Protected routes
router.get('/me', authenticateToken, authController.getMe);
router.post('/change-password', authenticateToken, authController.changePassword);
router.post('/logout', authenticateToken, authController.logout);



//commong

router.get('/notifications', authenticateToken, authController.getNotifications);
// Mark a specific notification as read
router.put('/notifications/:id/read', authenticateToken, authController.markNotificationAsRead);

// Mark all notifications as read for the logged-in user
router.put('/notifications/read-all', authenticateToken, authController.markAllNotificationsAsRead);
module.exports = router;