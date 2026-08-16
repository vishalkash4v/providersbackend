const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required in .env');
}

// Generate JWT Token
function generateToken(user) {
  return jwt.sign(
    {
      id: user._id || user.id,
      email: user.email,
      role: user.role, // 0 = Customer, 1 = Provider, 2 = Admin
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Authenticate Token Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    req.user = decoded; // { id, email, role }
    next();
  });
}

// Optional: Only for Admin
function isAdmin(req, res, next) {
  if (req.user.role !== 2) {
    return res.status(403).json({
      success: false,
      message: 'Admin access only'
    });
  }
  next();
}

module.exports = {
  generateToken,
  authenticateToken,
  isAdmin
};