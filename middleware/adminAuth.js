const jwt = require('jsonwebtoken');
const User = require('../models/User');

const isAdmin = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Fetch user from DB to ensure they still exist and check their role
        const user = await User.findById(decoded.id);

        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found.' });
        }

        // Check if role is Admin (2)
        if (Number(user.role) !== 2) {
            return res.status(403).json({ success: false, message: 'Forbidden. Admin access required.' });
        }

        // Attach user info to request
        req.user = user;
        next();

    } catch (error) {
        console.error('Admin Auth Error:', error.message);
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
};

module.exports = { isAdmin };