const mongoose = require('mongoose');

const r2StorageUsageSchema = new mongoose.Schema(
  {
    month: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    usedBytes: {
      type: Number,
      default: 0,
      min: 0,
    },

    limitBytes: {
      type: Number,
      default: 8 * 1024 * 1024 * 1024, // 8 GB
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.model(
    'R2StorageUsage',
    r2StorageUsageSchema
  );