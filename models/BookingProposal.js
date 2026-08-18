const mongoose = require('mongoose');

const BookingProposalSchema = new mongoose.Schema(
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
    // WHO CREATED THIS PROPOSAL
    // ============================================================

    proposedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // USER or PROVIDER
    proposedByRole: {
      type: String,
      enum: [
        'USER',
        'PROVIDER',
      ],
      required: true,
    },

    // ============================================================
    // PROPOSED VISIT DATE/TIME
    // ============================================================

    proposedDate: {
      type: Date,
      required: true,
    },

    proposedTimeStart: {
      type: String,
      required: true,
    },

    proposedTimeEnd: {
      type: String,
      required: true,
    },

    // ============================================================
    // PROPOSAL STATUS
    // ============================================================

    status: {
      type: String,
      enum: [
        'PENDING',
        'ACCEPTED',
        'REJECTED',
        'SUPERSEDED',
      ],
      default: 'PENDING',
    },

    // Optional message
    message: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// ============================================================
// INDEX
// ============================================================

BookingProposalSchema.index({
  booking: 1,
  createdAt: -1,
});

module.exports = mongoose.model(
  'BookingProposal',
  BookingProposalSchema
);