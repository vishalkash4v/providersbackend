const mongoose = require('mongoose');

const notificationSchema =
  new mongoose.Schema(
    {
      // ==========================================================
      // RECEIVER
      // ==========================================================

      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
      },

      // ==========================================================
      // NOTIFICATION TYPE
      // ==========================================================

      type: {
        type: String,

        enum: [
          'NEW_BOOKING_REQUEST',
          'BOOKING_UPDATED',
          'BOOKING_UNAVAILABLE',
          'LOGIN_SUCCESS',

          'PROVIDER_ACCEPTED',

          'VISIT_TIME_PROPOSED',
          'VISIT_TIME_ACCEPTED',

          'BOOKING_CONFIRMED',
          'BOOKING_STARTED',
          'BOOKING_COMPLETED',

          'BOOKING_CANCELLED',
          'BOOKING_DECLINED',
          'BOOKING_EXPIRED',
        ],

        required: true,
      },

      // ==========================================================
      // TITLE
      // ==========================================================

      title: {
        type: String,
        required: true,
        trim: true,
      },

      // ==========================================================
      // MESSAGE
      // ==========================================================

      message: {
        type: String,
        required: true,
        trim: true,
      },

      // ==========================================================
      // BOOKING
      // ==========================================================

      booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        default: null,
        index: true,
      },

      // ==========================================================
      // PROPOSAL
      // ==========================================================

      proposal: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'BookingProposal',
        default: null,
      },

      // ==========================================================
      // SERVICE
      // ==========================================================

      service: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
        default: null,
      },

      // ==========================================================
      // DISTANCE
      // ==========================================================

      distanceInKm: {
        type: Number,
        default: null,
      },

      // ==========================================================
      // EXTRA DATA
      // ==========================================================

      data: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
      },

      // ==========================================================
      // READ STATUS
      // ==========================================================

      isRead: {
        type: Boolean,
        default: false,
        index: true,
      },

      readAt: {
        type: Date,
        default: null,
      },
    },

    {
      timestamps: true,
    }
  );

// ============================================================
// EXPORT
// ============================================================

module.exports =
  mongoose.model(
    'Notification',
    notificationSchema
  );