const mongoose = require('mongoose');

const bookingOfferSchema = new mongoose.Schema(
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
    // PROVIDER
    // ============================================================

    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ============================================================
    // PROVIDER OFFER AMOUNT
    // ============================================================

    offerAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    // ============================================================
    // OFFER STATUS
    // ============================================================

    /*
     * PENDING
     * Provider has submitted offer.
     *
     * USER_ACCEPTED
     * Customer accepted this provider's offer.
     * Provider must now approve.
     *
     * PROVIDER_APPROVED
     * Provider successfully approved.
     * Booking is assigned to this provider.
     *
     * REJECTED
     * Offer rejected.
     *
     * EXPIRED
     * Approval window expired.
     *
     * CANCELLED
     * Offer cancelled.
     */

    status: {
      type: String,
      enum: [
        'PENDING',
        'USER_ACCEPTED',
        'PROVIDER_APPROVED',
        'REJECTED',
        'EXPIRED',
        'CANCELLED',
      ],
      default: 'PENDING',
      index: true,
    },

    // ============================================================
    // USER ACCEPTED TIME
    // ============================================================

    userAcceptedAt: {
      type: Date,
      default: null,
    },

    // ============================================================
    // PROVIDER APPROVAL WINDOW
    // ============================================================

    providerApprovalExpiresAt: {
      type: Date,
      default: null,
    },

    // ============================================================
    // PROVIDER APPROVAL
    // ============================================================

    providerApprovedAt: {
      type: Date,
      default: null,
    },

    // ============================================================
    // JOB ACCESS TYPE
    // ============================================================

    /*
     * FREE_CREDIT
     * Provider used one free booking credit.
     *
     * PAID
     * Provider paid the job access fee.
     */

    accessType: {
      type: String,
      enum: [
        'FREE_CREDIT',
        'PAID',
        null,
      ],
      default: null,
    },

    // ============================================================
    // JOB ACCESS FEE
    // ============================================================

    /*
     * Amount provider has to pay if no free credit exists.
     */

    accessFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ============================================================
    // DISTANCE
    // ============================================================

    /*
     * Distance between provider and booking location.
     */

    distanceKm: {
      type: Number,
      default: null,
      min: 0,
    },

    // ============================================================
    // PAYMENT
    // ============================================================

    paymentStatus: {
      type: String,
      enum: [
        'NOT_REQUIRED',
        'PENDING',
        'PAID',
        'FAILED',
      ],
      default: 'NOT_REQUIRED',
    },

    paymentId: {
      type: String,
      default: null,
    },

    paymentPaidAt: {
      type: Date,
      default: null,
    },
  },

  {
    timestamps: true,
  }
);


// ============================================================
// ONE OFFER PER PROVIDER FOR ONE BOOKING
// ============================================================

bookingOfferSchema.index(
  {
    booking: 1,
    provider: 1,
  },
  {
    unique: true,
  }
);


module.exports =
  mongoose.model(
    'BookingOffer',
    bookingOfferSchema
  );