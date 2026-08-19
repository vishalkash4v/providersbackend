const mongoose = require('mongoose');

const bookingPaymentSchema = new mongoose.Schema(
  {
    // ============================================================
    // BOOKING
    // ============================================================

    booking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true,
      index: true,
    },

    // ============================================================
    // OFFER
    // ============================================================

    offer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BookingOffer',
      required: true,
      index: true,
    },

    // ============================================================
    // PROVIDER
    // ============================================================

    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ============================================================
    // AMOUNT
    // ============================================================

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    currency: {
      type: String,
      default: 'INR',
      uppercase: true,
      trim: true,
    },

    // ============================================================
    // RAZORPAY ORDER
    // ============================================================

    razorpayOrderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // ============================================================
    // RAZORPAY PAYMENT
    // ============================================================

    razorpayPaymentId: {
      type: String,
      default: null,
      index: true,
    },

    razorpaySignature: {
      type: String,
      default: null,
    },

    // ============================================================
    // PAYMENT STATUS
    // ============================================================

    status: {
      type: String,
      enum: [
        'CREATED',
        'PENDING',
        'PAID',
        'FAILED',
        'REFUNDED',
        'CANCELLED',
      ],
      default: 'CREATED',
      index: true,
    },

    // ============================================================
    // WEBHOOK
    // ============================================================

    webhookVerified: {
      type: Boolean,
      default: false,
    },

    webhookEvent: {
      type: String,
      default: null,
    },

    // ============================================================
    // PAYMENT TIMESTAMPS
    // ============================================================

    paidAt: {
      type: Date,
      default: null,
    },

    failedAt: {
      type: Date,
      default: null,
    },

    // ============================================================
    // FAILURE DETAILS
    // ============================================================

    failureReason: {
      type: String,
      default: null,
    },

    // ============================================================
    // GENERAL DESCRIPTION
    // ============================================================

    description: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.model(
    'BookingPayment',
    bookingPaymentSchema
  );