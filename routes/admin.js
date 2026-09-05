const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin');
const { isAdmin } = require('../middleware/adminAuth');
const ensureDB = require('../middleware/db');

// Apply DB connection middleware to all auth routes
router.use(ensureDB);
// 1. Auth & Dashboard
router.post('/login', adminController.adminLogin);
router.post('/logout', isAdmin, adminController.adminLogout);
router.get('/dashboard', isAdmin, adminController.getDashboardStats);

// 2. Users CRUD
router.get('/users', isAdmin, adminController.getAllUsers);
router.get('/users/:id', isAdmin, adminController.getUserById);
router.put('/users/:id', isAdmin, adminController.updateUser);
router.delete('/users/:id', isAdmin, adminController.deleteUser);

// 3. Providers CRUD
router.get('/providers', isAdmin, adminController.getAllProviders);
router.get('/providers/:id', isAdmin, adminController.getProviderById);
router.put('/providers/:id', isAdmin, adminController.updateProvider);
router.delete('/providers/:id', isAdmin, adminController.deleteProvider);

// 4. Bookings CRUD
router.get('/bookings', isAdmin, adminController.getAllBookings);
router.put('/bookings/:id', isAdmin, adminController.updateBookingAdmin);
router.delete('/bookings/:id', isAdmin, adminController.deleteBookingAdmin);

// 5. Offers CRUD
router.get('/offers', isAdmin, adminController.getAllOffers);
router.put('/offers/:id', isAdmin, adminController.updateOfferAdmin);
router.delete('/offers/:id', isAdmin, adminController.deleteOfferAdmin);

// 6. Transactions CRUD
router.get('/transactions', isAdmin, adminController.getAllTransactions);
router.put('/transactions/:id', isAdmin, adminController.updateTransactionAdmin);
router.delete('/transactions/:id', isAdmin, adminController.deleteTransactionAdmin);

// 7. Services CRUD
router.get('/services', isAdmin, adminController.getAllServices);
router.post('/services', isAdmin, adminController.addService);
router.put('/services/:id', isAdmin, adminController.updateService);
router.delete('/services/:id', isAdmin, adminController.deleteService);

router.get('/support', isAdmin, adminController.getSupportTickets);
// ... existing admin routes ...
router.post('/policy', isAdmin, adminController.upsertPolicy); // Handles both Create & Update
router.get('/policies', isAdmin, adminController.getPolicies);
router.get('/policy/:type', isAdmin, adminController.getPolicies);
router.delete('/policy/:id', isAdmin, adminController.deletePolicy);
// ============================================================
// ADMIN: PROFILE IMAGE APPROVAL ROUTES
// ============================================================

// 1. Fetch all users/providers with pending profile images
// Endpoint: GET /api/admin/pending-images
router.get('/pending-images', isAdmin, adminController.getPendingProfileImages);

// 2. Approve or Reject a specific pending image
// Endpoint: PUT /api/admin/review-image
router.put('/review-image', isAdmin, adminController.reviewProviderImage);
module.exports = router;