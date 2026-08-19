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


router.patch(
  '/status/:id',
  authenticateToken,
  bookingController.updateBookingStatus
);

router.patch(
  '/:id/accept',
  authenticateToken,
  bookingController.acceptBooking
);

router.patch(
  '/:id/reject',
  authenticateToken,
  bookingController.rejectBooking
);

router.patch(
  '/:id/propose-visit',
  authenticateToken,
  bookingController.proposeVisitTime
);

router.patch(
  '/:id/accept-visit',
  authenticateToken,
  bookingController.acceptVisitTime
);

router.patch(
  '/:id/counter-visit',
  authenticateToken,
  bookingController.counterVisitTime
);

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