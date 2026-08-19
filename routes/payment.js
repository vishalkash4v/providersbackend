const express = require('express');

const router = express.Router();

const paymentController =
  require('../controllers/paymentController');

const {
  authenticateToken,
} = require('../middleware/jwt');

const ensureDB =
  require('../middleware/db');


// ============================================================
// DATABASE MIDDLEWARE
// ============================================================

router.use(ensureDB);


// ============================================================
// CREATE BOOKING PAYMENT ORDER
// ============================================================
//
// Provider has no free booking credit.
// This creates a Razorpay order for the booking offer.
//
// POST
// /api/payment/booking/create-order
//
// Body:
// {
//   "offerId": "BOOKING_OFFER_ID"
// }
//

router.post(
  '/booking/create-order',
  authenticateToken,
  paymentController.createBookingPaymentOrder
);


// ============================================================
// VERIFY RAZORPAY CHECKOUT PAYMENT
// ============================================================
//
// This is called by frontend after Razorpay Checkout.
//
// POST
// /api/payment/booking/verify
//
// Body:
// {
//   "offerId": "...",
//   "razorpayOrderId": "...",
//   "razorpayPaymentId": "...",
//   "razorpaySignature": "..."
// }
//

router.post(
  '/booking/verify',
  authenticateToken,
  paymentController.verifyBookingPayment
);


// ============================================================
// RAZORPAY WEBHOOK
// ============================================================
//
// IMPORTANT:
// Do NOT use authenticateToken here.
//
// Razorpay calls this endpoint directly.
//
// app.js already applies express.raw()
// BEFORE express.json() for this exact path.
//
// POST
// /api/payment/razorpay/webhook
//

router.post(
  '/razorpay/webhook',
  paymentController.razorpayWebhook
);


// ============================================================
// PAYMENT STATUS
// ============================================================
//
// GET
// /api/payment/booking/:offerId/status
//

router.get(
  '/booking/:offerId/status',
  authenticateToken,
  paymentController.getBookingPaymentStatus
);

router.get(
    '/booking/checkout/:offerId',
    
    paymentController.renderBookingCheckout
);


module.exports = router;