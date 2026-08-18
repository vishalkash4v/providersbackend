const mongoose = require('mongoose');

const UserDeviceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    deviceToken: {
      type: String,
      required: true,
      trim: true,
    },

    // 0 = Android
    // 1 = iOS
    deviceType: {
      type: Number,
      enum: [0, 1],
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Same user + same device token should exist only once
UserDeviceSchema.index(
  {
    user: 1,
    deviceToken: 1,
  },
  {
    unique: true,
  }
);

module.exports = mongoose.model(
  'UserDevice',
  UserDeviceSchema
);