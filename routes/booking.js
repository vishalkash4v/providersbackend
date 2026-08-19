const express = require('express');

const router = express.Router();

const bookingController =
  require('../controllers/booking');

const { authenticateToken } =
  require('../middleware/jwt');

const ensureDB =
  require('../middleware/db');


// ============================================================
// DATABASE MIDDLEWARE
// ============================================================

router.use(ensureDB);


// ============================================================
// CREATE BOOKING
// ============================================================

router.post(
  '/booknow',
  authenticateToken,
  bookingController.createBooking
);


// ============================================================
// UPDATE BOOKING
// ============================================================

router.put(
  '/update-booking/:id',
  authenticateToken,
  bookingController.updateBooking
);


// ============================================================
// DELETE BOOKING
// ============================================================

router.delete(
  '/delete/:id',
  authenticateToken,
  bookingController.deleteBooking
);


// ============================================================
// UPDATE BOOKING ACTIVE / INACTIVE STATUS
// ============================================================

router.patch(
  '/status/:id',
  authenticateToken,
  bookingController.updateBookingStatus
);


// ============================================================
// PROVIDER SEND OFFER
// ============================================================
//
// Provider receives booking request and sends his offer amount.
//
// Example:
// POST /api/booking/:id/offer
//
// Body:
// {
//   "offerAmount": 500
// }
//

router.post(
  '/:id/offer',
  authenticateToken,
  bookingController.createBookingOffer
);


// ============================================================
// USER ACCEPT OFFER
// ============================================================
//
// User can accept multiple provider offers.
//
// Example:
// PATCH /api/booking/offers/:offerId/accept
//

router.patch(
  '/offers/:offerId/accept',
  authenticateToken,
  bookingController.acceptBookingOffer
);


// ============================================================
// PROVIDER APPROVE OFFER
// ============================================================
//
// After user accepts provider offer,
// provider gets approval request.
//
// At provider approval stage:
// - Free booking credit is checked
// - OR payment is required
// - First successful provider approval wins
//
// Example:
// PATCH /api/booking/offers/:offerId/approve
//

router.patch(
  '/offers/:offerId/approve',
  authenticateToken,
  bookingController.approveBookingOffer
);


// ============================================================
// PROVIDER PROPOSE VISIT TIME
// ============================================================

router.patch(
  '/:id/propose-visit',
  authenticateToken,
  bookingController.proposeVisitTime
);


// ============================================================
// USER ACCEPT VISIT TIME
// ============================================================

router.patch(
  '/:id/accept-visit',
  authenticateToken,
  bookingController.acceptVisitTime
);


// ============================================================
// USER COUNTER VISIT TIME
// ============================================================

router.patch(
  '/:id/counter-visit',
  authenticateToken,
  bookingController.counterVisitTime
);


// ============================================================
// PROVIDER ACCEPT COUNTER VISIT TIME
// ============================================================

router.patch(
  '/:id/accept-counter-visit',
  authenticateToken,
  bookingController.acceptCounterVisitTime
);


// ============================================================
// USER BOOKINGS
// ============================================================

router.get(
  '/my-bookings',
  authenticateToken,
  bookingController.getMyBookings
);


// ============================================================
// BOOKING DETAILS
// ============================================================

router.get(
  '/details/:id',
  authenticateToken,
  bookingController.getBookingDetails
);


// ============================================================
// PROVIDER JOBS
// ============================================================

router.get(
  '/provider/jobs',
  authenticateToken,
  bookingController.getProviderJobs
);


// ============================================================
// PROVIDER JOB DETAILS
// ============================================================

router.get(
  '/provider/jobs/:id',
  authenticateToken,
  bookingController.getProviderJobDetails
);


module.exports = router;