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

    // 👇 ONLY THIS NEW FIELD REQUIRED 👇
    proposedDate: {
        type: String,
        default: null,
    },
    proposedTime: {     
        type: String,
        default: null,
    },
    // ============================================================
    // OFFER STATUS
    // ============================================================
    status: {
        type: Number,
        enum: [0, 1, 2, 3, 4, 5],
        default: 0
        // 0 = Pending (Offer sent to user)
        // 1 = Accepted by User (Waiting for provider final approval)
        // 2 = Rejected by User
        // 3 = Accepted by Provider (Final confirmation, booking is now assigned)
        // 4 = Rejected by Provider (Provider cancelled after user accepted)
        // 5 = Offer Time Out (Provider didn't respond in time)
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
    accessFee: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ============================================================
    // DISTANCE
    // ============================================================
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
    rejectionReason: {
      type: String,
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

module.exports = mongoose.model('BookingOffer', bookingOfferSchema);