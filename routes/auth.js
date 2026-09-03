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

// ... baaki routes ...

// Delete specific notification (ID URL mein aayegi)
router.delete('/notifications/:notificationId', authenticateToken, authController.deleteNotification);

// Clear all notifications ek sath
router.delete('/notifications', authenticateToken, authController.clearAllNotifications);

// POST /api/auth/support
router.post('/support', authenticateToken, authController.createSupportTicket);
// ... existing auth routes ...
// No JWT middleware needed if you want users to read policies before logging in
router.get('/policy/:type', authController.getPolicyByType);
// DELETE /api/auth/delete-account
router.post('/deleteAccount', authenticateToken, authController.deleteAccount);
router.get('/testOtp', authController.testOtp);
module.exports = router;