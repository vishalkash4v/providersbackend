const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema(
  {
    // Provider who invited the other provider
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // Provider who registered using the referral
    referredProvider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },

    // Referral code used during registration
    referralCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },

    // PENDING until referred provider gets first job
    // SUCCESS after first job
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS'],
      default: 'PENDING',
      index: true,
    },

    // Number of free booking credits given to referrer
    rewardCredits: {
      type: Number,
      default: 0,
      min: 0,
    },

    // First booking/job of referred provider
    firstBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },

    // When referral became successful
    successfulAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.model('Referral', referralSchema);