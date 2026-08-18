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


module.exports = router;