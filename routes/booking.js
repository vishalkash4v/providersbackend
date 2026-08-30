const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/booking');
const { authenticateToken } = require('../middleware/jwt');
const ensureDB = require('../middleware/db');

// ============================================================
// DATABASE MIDDLEWARE
// ============================================================
router.use(ensureDB);

// ============================================================
// BOOKING CRUD
// ============================================================
router.post('/booknow', authenticateToken, bookingController.createBooking);
router.put('/update-booking/:id', authenticateToken, bookingController.updateBooking);
router.delete('/delete/:id', authenticateToken, bookingController.deleteBooking);

// ============================================================
// FETCH BOOKINGS (UNIFIED)
// ============================================================
router.get('/my-bookings', authenticateToken, bookingController.getMyBookings);
router.get('/details/:id', authenticateToken, bookingController.getBookingDetails);

// ============================================================
// OFFERS MANAGEMENT
// ============================================================

// Fetch all offers (or filter by ?bookingId=xyz)
router.get('/offers', authenticateToken, bookingController.getOffers);

// Provider: Create Offer
router.post('/:id/offer', authenticateToken, bookingController.createBookingOffer);

// User: Accept Offer
router.patch('/offers/:offerId/accept', authenticateToken, bookingController.acceptBookingOffer);

// User: Reject Offer (Send { rejectionReason: "Too expensive" } in body)
router.patch('/offers/:offerId/reject', authenticateToken, bookingController.rejectBookingOffer);

// Provider: Final Approve (Confirms Job)
router.patch('/offers/:offerId/approve', authenticateToken, bookingController.approveBookingOffer);

// Provider: Cancel/Reject Offer (After user accepted)
router.patch('/offers/:offerId/cancel', authenticateToken, bookingController.cancelBookingOffer);
// PUT /api/booking/:id/remove
router.post('/:id/remove', authenticateToken, bookingController.removeBookingRequest);
module.exports = router;