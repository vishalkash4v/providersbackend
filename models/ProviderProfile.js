const mongoose = require('mongoose');

const providerProfileSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    services: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
      },
    ],
    radius: {
      type: Number, // in KM
      default: 10,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
      // 👇 THIS IS WHAT WAS MISSING 👇
      name: {
        type: String,
        default: '',
        trim: true
      }
    },
    address: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

// Important for nearby search
providerProfileSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('ProviderProfile', providerProfileSchema);