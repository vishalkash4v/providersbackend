const mongoose = require('mongoose');

const bookingCreditTransactionSchema =
  new mongoose.Schema(
    {
      provider: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
      },

      type: {
        type: String,
        enum: [
          'INITIAL_FREE',
          'REFERRAL_REWARD',
          'BOOKING_USED',
          'ADMIN_ADJUSTMENT',
          'WELCOME_BONUS',
        ],
        required: true,
      },

      amount: {
        type: Number,
        required: true,
      },

      balanceBefore: {
        type: Number,
        required: true,
      },

      balanceAfter: {
        type: Number,
        required: true,
      },

      referral: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Referral',
        default: null,
      },

      booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        default: null,
      },

      description: {
        type: String,
        default: '',
      },
    },
    {
      timestamps: true,
    }
  );

module.exports =
  mongoose.model(
    'BookingCreditTransaction',
    bookingCreditTransactionSchema
  );