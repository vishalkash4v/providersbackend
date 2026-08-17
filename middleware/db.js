const { connectDB } = require('../utils/db');

const ensureDB = async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('DB Connection Error:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error: error.message,
    });
  }
};

module.exports = ensureDB;