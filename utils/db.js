const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is required');
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      maxPoolSize: 5, // Lower pool size to stay well under Atlas limits across multiple instances
      serverSelectionTimeoutMS: 15000, // Increase to 15s to allow Vercel cold starts time to connect
      socketTimeoutMS: 45000,
    };

    cached.promise = mongoose
      .connect(MONGODB_URI, opts)
      .then((mongoose) => {
        console.log('MongoDB Connected');
        return mongoose;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    // CRITICAL FIX: Reset cached promise on failure so next request retries fresh
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}

module.exports = { connectDB };