var mongoose = require('mongoose');

// MongoDB Connection - must be set in .env
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  throw new Error('MONGODB_URI is required in .env');
}

// Cache the connection to reuse in serverless environments
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  // If already connected, return immediately
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (cached.conn && mongoose.connection.readyState === 1) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: true, // Changed to true to allow commands before connection
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000, // Increased timeout
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      console.log('MongoDB connected successfully');
      console.log('Database:', mongoose.connection.name);
      cached.conn = mongoose.connection;
      return mongoose.connection;
    }).catch((err) => {
      cached.promise = null;
      console.error('MongoDB connection error:', err.message);
      throw err;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.log('MongoDB connection failed');
    console.error('MongoDB connection error:', e.message);
    throw e;
  }

  return cached.conn;
}

module.exports = { connectDB };
