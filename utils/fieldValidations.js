const validate = (req, res, required = []) => {
  const data = req.body;

  // Required fields check
  const missing = required.filter(
    (field) => !data[field] || (typeof data[field] === 'string' && !data[field].trim())
  );

  if (missing.length === 1) {
    res.status(400).json({
      success: false,
      message: `${missing[0]} is required`,
    });
    return true;
  }

  if (missing.length > 1) {
    res.status(400).json({
      success: false,
      message: `${missing.join(', ')} are required`,
    });
    return true;
  }

  // Email validation
  if (required.includes('email') && data.email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      res.status(400).json({
        success: false,
        message: 'Please enter a valid email',
      });
      return true;
    }
  }

  // Mobile validation
  if (required.includes('mobile') && data.mobile) {
    if (!/^[0-9]{10}$/.test(data.mobile)) {
      res.status(400).json({
        success: false,
        message: 'Please enter a valid 10 digit mobile number',
      });
      return true;
    }
  }

  // Password strength
  if (required.includes('password') && data.password) {
    const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!strong.test(data.password)) {
      res.status(400).json({
        success: false,
        message: 'Password must be strong (8+ characters, uppercase, lowercase, number & special character)',
      });
      return true;
    }
  }

  // Confirm Password
  if (required.includes('confirmPassword') && data.password !== data.confirmPassword) {
    res.status(400).json({
      success: false,
      message: 'Password and Confirm Password do not match',
    });
    return true;
  }

  // Role
  if (required.includes('role') && ![0, 1].includes(Number(data.role))) {
    res.status(400).json({
      success: false,
      message: 'Invalid role. Use 0 for Customer or 1 for Provider',
    });
    return true;
  }

  return false;
};

module.exports = { validate };