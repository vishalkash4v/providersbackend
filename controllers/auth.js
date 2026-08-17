const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { uploadSingleFile } = require('../utils/expressfileupload'); // or your file name

const {
  generateToken,
} = require('../middleware/jwt');

const sendEmail = require('../utils/sendEmail');

const {
  validate,
} = require('../utils/fieldValidations');

const {
  generateReferralCode,
} = require('../utils/referral');

const jwt = require('jsonwebtoken');
const TokenBlacklist = require('../models/TokenBlacklist');
module.exports = {

  // ============================================================
  // REGISTER
  // ============================================================


// ============================================================
// REGISTER
// ============================================================
register: async (req, res) => {
  try {
    const required = [
      'firstName',
      'lastName',
      'mobile',
      'email',
      'password',
      'confirmPassword',
      'role',
    ];

    if (validate(req, res, required)) return;

    const {
      firstName,
      lastName,
      mobile,
      email,
      password,
      confirmPassword,
      role,
      latitude,
      longitude,
      locationName,
      referralCode: enteredReferralCode,
    } = req.body;

    // ====================== PASSWORD MATCH ======================
    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: 'Password and confirm password do not match',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedMobile = mobile.trim();

    // ====================== FIND EXISTING USERS ======================
    const existingEmailUser = await User.findOne({
      email: normalizedEmail,
    });

    const existingMobileUser = await User.findOne({
      mobile: normalizedMobile,
    });

    // ====================== VERIFIED EMAIL ======================
    if (existingEmailUser && existingEmailUser.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
      });
    }

    // ====================== VERIFIED MOBILE ======================
    if (existingMobileUser && existingMobileUser.isVerified) {
      return res.status(400).json({
        success: false,
        message: 'Mobile number already registered',
      });
    }

    // ============================================================
    // EMAIL AND MOBILE BELONG TO DIFFERENT UNVERIFIED USERS
    // ============================================================
    if (
      existingEmailUser &&
      existingMobileUser &&
      existingEmailUser._id.toString() !==
        existingMobileUser._id.toString()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Email and Mobile number are associated with different accounts',
      });
    }

    // ============================================================
    // EXISTING UNVERIFIED USER
    // ============================================================
    let existingUser = existingEmailUser || existingMobileUser;

    // ====================== REFERRAL ======================
    let referredBy = existingUser?.referredBy || null;

    if (enteredReferralCode && enteredReferralCode.trim() !== '') {
      const normalizedReferralCode =
        enteredReferralCode.trim().toUpperCase();

      const referringUser = await User.findOne({
        referralCode: normalizedReferralCode,
        isActive: true,
      });

      if (!referringUser) {
        return res.status(400).json({
          success: false,
          message: 'Invalid referral code',
        });
      }

      // User cannot refer himself
      if (
        existingUser &&
        referringUser._id.toString() === existingUser._id.toString()
      ) {
        return res.status(400).json({
          success: false,
          message: 'You cannot use your own referral code',
        });
      }

      referredBy = referringUser._id;
    }

    // ====================== LOCATION ======================
    let location = existingUser?.location || null;

    const hasLatitude =
      latitude !== undefined &&
      latitude !== null &&
      latitude !== '';

    const hasLongitude =
      longitude !== undefined &&
      longitude !== null &&
      longitude !== '';

    const hasLocationName =
      locationName &&
      locationName.trim() !== '';

    if (hasLatitude || hasLongitude || hasLocationName) {
      if (!hasLatitude || !hasLongitude) {
        return res.status(400).json({
          success: false,
          message:
            'Both latitude and longitude are required when providing location',
        });
      }

      const lat = Number(latitude);
      const lng = Number(longitude);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({
          success: false,
          message: 'Latitude and longitude must be valid numbers',
        });
      }

      if (lat < -90 || lat > 90) {
        return res.status(400).json({
          success: false,
          message: 'Latitude must be between -90 and 90',
        });
      }

      if (lng < -180 || lng > 180) {
        return res.status(400).json({
          success: false,
          message: 'Longitude must be between -180 and 180',
        });
      }

      location = {
        type: 'Point',
        coordinates: [lng, lat],
      };

      if (hasLocationName) {
        location.name = locationName.trim();
      }
    }

    // ====================== PROFILE IMAGE ======================
    let profileImage = existingUser?.profileImage || null;

    if (req.files && req.files.profileImage) {
      const uploaded = await uploadSingleFile(
        req,
        'profileImage',
        'uploads/profiles'
      );

      if (uploaded) {
        profileImage = uploaded.path;
      }
    }

    // ====================== PASSWORD ======================
    const hashedPassword = await bcrypt.hash(password, 12);

    // ====================== OTP ======================
    const otp = Math.floor(1000 + Math.random() * 9000).toString();

    const otpExpires = new Date(
      Date.now() + 10 * 60 * 1000
    );

    // ============================================================
    // UPDATE EXISTING UNVERIFIED USER
    // ============================================================
    if (existingUser) {
      existingUser.firstName = firstName.trim();
      existingUser.lastName = lastName.trim();
      existingUser.mobile = normalizedMobile;
      existingUser.email = normalizedEmail;
      existingUser.password = hashedPassword;
      existingUser.role = Number(role);

      existingUser.referredBy = referredBy;
      existingUser.profileImage = profileImage;

      existingUser.otp = otp;
      existingUser.otpExpires = otpExpires;
      existingUser.isVerified = false;

      if (location) {
        existingUser.location = location;
      }

      await existingUser.save();

      // ====================== SEND OTP ======================
      await sendEmail({
        email: existingUser.email,
        subject: 'OTP Verification - Provider App',
        html: `
          <h2>Hello ${existingUser.firstName},</h2>
          <p>Your new OTP for verification is:</p>
          <h1 style="letter-spacing: 5px;">${otp}</h1>
          <p>This OTP is valid for 10 minutes.</p>
        `,
      });

      const token = generateToken(existingUser);

      return res.status(200).json({
        success: true,
        message:
          'Registration details updated. New OTP sent to your email.',
        token,
        data: {
          userId: existingUser._id,
          firstName: existingUser.firstName,
          lastName: existingUser.lastName,
          email: existingUser.email,
          mobile: existingUser.mobile,
          role: existingUser.role,
          referralCode: existingUser.referralCode,
          referredBy: existingUser.referredBy,
          profileImage: existingUser.profileImage,
          location: existingUser.location || null,
          isVerified: existingUser.isVerified,
        },
      });
    }

    // ============================================================
    // NEW USER
    // ============================================================

    // ====================== GENERATE UNIQUE REFERRAL CODE ======================
    let userReferralCode;

    while (true) {
      userReferralCode = generateReferralCode();

      const exists = await User.findOne({
        referralCode: userReferralCode,
      });

      if (!exists) break;
    }

    // ====================== CREATE USER ======================
    const userData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      mobile: normalizedMobile,
      email: normalizedEmail,
      password: hashedPassword,
      role: Number(role),

      referralCode: userReferralCode,
      referredBy,

      profileImage,

      otp,
      otpExpires,

      isVerified: false,
    };

    if (location) {
      userData.location = location;
    }

    const user = await User.create(userData);

    // ====================== SEND OTP ======================
    await sendEmail({
      email: user.email,
      subject: 'OTP Verification - Provider App',
      html: `
        <h2>Hello ${user.firstName},</h2>
        <p>Your OTP for verification is:</p>
        <h1 style="letter-spacing: 5px;">${otp}</h1>
        <p>This OTP is valid for 10 minutes.</p>
      `,
    });

    // ====================== TOKEN ======================
    const token = generateToken(user);

    // ====================== RESPONSE ======================
    return res.status(201).json({
      success: true,
      message: 'Registration successful. OTP sent to your email.',
      token,
      data: {
        userId: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        profileImage: user.profileImage,
        location: user.location || null,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error('Register Error:', error);

    // ====================== DUPLICATE KEY ======================
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email or Mobile number already registered',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: error.message,
    });
  }
},


updateProfile: async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
    }

    const {
      firstName,
      lastName,
      mobile,
      email,
      latitude,
      longitude,
      locationName,
    } = req.body;

    // ====================== FIND USER ======================
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // ====================== EMAIL ======================
    let normalizedEmail;

    if (email !== undefined) {
      if (!email || !email.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Email is required',
        });
      }

      normalizedEmail = email.trim().toLowerCase();

      // Check email already used by another user
      const existingEmail = await User.findOne({
        email: normalizedEmail,
        _id: { $ne: userId },
      });

      if (existingEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered',
        });
      }

      user.email = normalizedEmail;
    }

    // ====================== MOBILE ======================
    if (mobile !== undefined) {
      const normalizedMobile = mobile.trim();

      if (!/^[0-9]{10}$/.test(normalizedMobile)) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid 10 digit mobile number',
        });
      }

      // Check mobile already used by another user
      const existingMobile = await User.findOne({
        mobile: normalizedMobile,
        _id: { $ne: userId },
      });

      if (existingMobile) {
        return res.status(400).json({
          success: false,
          message: 'Mobile number already registered',
        });
      }

      user.mobile = normalizedMobile;
    }

    // ====================== FIRST NAME ======================
    if (firstName !== undefined) {
      if (!firstName.trim()) {
        return res.status(400).json({
          success: false,
          message: 'First name is required',
        });
      }

      user.firstName = firstName.trim();
    }

    // ====================== LAST NAME ======================
    if (lastName !== undefined) {
      if (!lastName.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Last name is required',
        });
      }

      user.lastName = lastName.trim();
    }

    // ====================== PROFILE IMAGE ======================
    if (req.files && req.files.profileImage) {
      const uploaded = await uploadSingleFile(
        req,
        'profileImage',
        'uploads/profiles'
      );

      if (uploaded) {
        user.profileImage = uploaded.path;
      }
    }

    // ====================== LOCATION ======================
    const hasLatitude =
      latitude !== undefined &&
      latitude !== null &&
      latitude !== '';

    const hasLongitude =
      longitude !== undefined &&
      longitude !== null &&
      longitude !== '';

    const hasLocationName =
      locationName &&
      locationName.trim() !== '';

    // If any location field is provided
    if (hasLatitude || hasLongitude || hasLocationName) {
      // Existing location can be used if only locationName is being changed
      const existingLocation = user.location;

      let lat = existingLocation?.coordinates?.[1];
      let lng = existingLocation?.coordinates?.[0];

      if (hasLatitude) {
        lat = Number(latitude);
      }

      if (hasLongitude) {
        lng = Number(longitude);
      }

      // Latitude and longitude must exist
      if (
        lat === undefined ||
        lat === null ||
        lng === undefined ||
        lng === null
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Both latitude and longitude are required when providing location',
        });
      }

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({
          success: false,
          message: 'Latitude and longitude must be valid numbers',
        });
      }

      if (lat < -90 || lat > 90) {
        return res.status(400).json({
          success: false,
          message: 'Latitude must be between -90 and 90',
        });
      }

      if (lng < -180 || lng > 180) {
        return res.status(400).json({
          success: false,
          message: 'Longitude must be between -180 and 180',
        });
      }

      user.location = {
        type: 'Point',
        coordinates: [lng, lat],
      };

      if (hasLocationName) {
        user.location.name = locationName.trim();
      } else if (existingLocation?.name) {
        user.location.name = existingLocation.name;
      }
    }

    // ====================== SAVE ======================
    await user.save();

    // ====================== RESPONSE ======================
    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        userId: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        mobile: user.mobile,
        role: user.role,
        referralCode: user.referralCode,
        referredBy: user.referredBy,
        profileImage: user.profileImage,
        location: user.location || null,
        isVerified: user.isVerified,
      },
    });
  } catch (error) {
    console.error('Update Profile Error:', error);

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: error.message,
    });
  }
},

  // ============================================================
  // VERIFY OTP
  // ============================================================

  verifyOtp: async (req, res) => {

    try {

      const required = [
        'email',
        'otp',
      ];


      if (
        validate(
          req,
          res,
          required
        )
      ) {
        return;
      }


      const {
        email,
        otp,
      } = req.body;


      const user =
        await User.findOne({
          email:
            email.trim().toLowerCase(),
        });


      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }


      if (user.isVerified) {

        return res.status(400).json({
          success: false,
          message:
            'User already verified',
        });
      }


      if (user.otp !== otp) {

        return res.status(400).json({
          success: false,
          message:
            'Invalid OTP',
        });
      }


      if (
        !user.otpExpires ||
        user.otpExpires < new Date()
      ) {

        return res.status(400).json({
          success: false,
          message:
            'OTP has expired',
        });
      }


      user.isVerified =
        true;

      user.otp =
        undefined;

      user.otpExpires =
        undefined;


      await user.save();


      const token =
        generateToken(user);


      return res.status(200).json({

        success: true,

        message:
          'OTP verified successfully',

        token,

        data: {

          id:
            user._id,

          firstName:
            user.firstName,

          lastName:
            user.lastName,

          email:
            user.email,

          mobile:
            user.mobile,

          role:
            user.role,

          referralCode:
            user.referralCode,

          referredBy:
            user.referredBy,

          location:
            user.location || null,

          profileImage:
            user.profileImage,

          isVerified:
            user.isVerified,

        },
      });


    } catch (error) {

      console.error(
        'Verify OTP Error:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Something went wrong',

        error:
          error.message,

      });
    }
  },


  // ============================================================
  // RESEND OTP
  // ============================================================

  resendOtp: async (req, res) => {

    try {

      const required = [
        'email',
      ];


      if (
        validate(
          req,
          res,
          required
        )
      ) {
        return;
      }


      const {
        email,
      } = req.body;


      const user =
        await User.findOne({
          email:
            email.trim().toLowerCase(),
        });


      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }


      if (user.isVerified) {

        return res.status(400).json({
          success: false,
          message:
            'User already verified',
        });
      }


      const otp =
        Math.floor(
          1000 +
          Math.random() * 9000
        ).toString();


      const otpExpires =
        new Date(
          Date.now() +
          10 * 60 * 1000
        );


      user.otp =
        otp;

      user.otpExpires =
        otpExpires;


      await user.save();


      await sendEmail({

        email:
          user.email,

        subject:
          'Resend OTP - Provider App',

        html: `
          <h2>Hello ${user.firstName},</h2>

          <p>Your new OTP is:</p>

          <h1 style="letter-spacing: 5px;">
            ${otp}
          </h1>

          <p>
            This OTP is valid for 10 minutes.
          </p>
        `,
      });


      return res.status(200).json({

        success: true,

        message:
          'OTP resent successfully',

      });


    } catch (error) {

      console.error(
        'Resend OTP Error:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Something went wrong',

        error:
          error.message,

      });
    }
  },


  // ============================================================
  // LOGIN
  // ============================================================

  login: async (req, res) => {

    try {

      const required = [
        'email',
        'password',
      ];


      if (
        validate(
          req,
          res,
          required
        )
      ) {
        return;
      }


      const {
        email,
        password,
      } = req.body;


      const user =
        await User.findOne({
          email:
            email.trim().toLowerCase(),
        });


      if (!user) {

        return res.status(401).json({
          success: false,
          message:
            'Invalid email or password',
        });
      }


      if (!user.isVerified) {

        return res.status(401).json({
          success: false,
          message:
            'Please verify your account first',
        });
      }


      if (!user.isActive) {

        return res.status(401).json({
          success: false,
          message:
            'Your account has been deactivated',
        });
      }


      const isMatch =
        await bcrypt.compare(
          password,
          user.password
        );


      if (!isMatch) {

        return res.status(401).json({
          success: false,
          message:
            'Invalid email or password',
        });
      }


      const token =
        generateToken(user);


      return res.status(200).json({

        success: true,

        message:
          'Login successful',

        token,

        data: {

          id:
            user._id,

          firstName:
            user.firstName,

          lastName:
            user.lastName,

          email:
            user.email,

          mobile:
            user.mobile,

          role:
            user.role,

          referralCode:
            user.referralCode,

          referredBy:
            user.referredBy,

          location:
            user.location || null,

          profileImage:
            user.profileImage,

          isVerified:
            user.isVerified,

          isActive:
            user.isActive,

        },
      });


    } catch (error) {

      console.error(
        'Login Error:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Something went wrong',

        error:
          error.message,

      });
    }
  },


  // ============================================================
  // FORGOT PASSWORD
  // ============================================================

  forgotPassword: async (req, res) => {

    try {

      const required = [
        'email',
      ];


      if (
        validate(
          req,
          res,
          required
        )
      ) {
        return;
      }


      const {
        email,
      } = req.body;


      const user =
        await User.findOne({
          email:
            email.trim().toLowerCase(),
        });


      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }


      const otp =
        Math.floor(
          1000 +
          Math.random() * 9000
        ).toString();


      const otpExpires =
        new Date(
          Date.now() +
          10 * 60 * 1000
        );


      user.otp =
        otp;

      user.otpExpires =
        otpExpires;


      await user.save();


      await sendEmail({

        email:
          user.email,

        subject:
          'Forgot Password OTP - Provider App',

        html: `
          <h2>Hello ${user.firstName},</h2>

          <p>
            Your OTP for password reset is:
          </p>

          <h1 style="letter-spacing: 5px;">
            ${otp}
          </h1>

          <p>
            This OTP is valid for 10 minutes.
          </p>
        `,
      });


      return res.status(200).json({

        success: true,

        message:
          'OTP sent to your email',

      });


    } catch (error) {

      console.error(
        'Forgot Password Error:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Something went wrong',

        error:
          error.message,

      });
    }
  },


  // ============================================================
  // RESET PASSWORD
  // ============================================================

  resetPassword: async (req, res) => {

    try {

      const required = [
        'email',
        'otp',
        'newPassword',
      
      ];


      if (
        validate(
          req,
          res,
          required
        )
      ) {
        return;
      }


      const {
        email,
        otp,
        newPassword,
   
      } = req.body;


    


      const user =
        await User.findOne({
          email:
            email.trim().toLowerCase(),
        });


      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }


      if (user.otp !== otp) {

        return res.status(400).json({
          success: false,
          message:
            'Invalid OTP',
        });
      }


      if (
        !user.otpExpires ||
        user.otpExpires < new Date()
      ) {

        return res.status(400).json({
          success: false,
          message:
            'OTP has expired',
        });
      }


      user.password =
        await bcrypt.hash(
          newPassword,
          12
        );


      user.otp =
        undefined;

      user.otpExpires =
        undefined;


      await user.save();


      // Fresh JWT after password reset
      const token =
        generateToken(user);


      return res.status(200).json({

        success: true,

        message:
          'Password reset successfully',

        token,

        data: {

          id:
            user._id,

          firstName:
            user.firstName,

          lastName:
            user.lastName,

          email:
            user.email,

          mobile:
            user.mobile,

          role:
            user.role,

          referralCode:
            user.referralCode,

          referredBy:
            user.referredBy,

          location:
            user.location || null,

          profileImage:
            user.profileImage,

          isVerified:
            user.isVerified,

          isActive:
            user.isActive,

        },
      });


    } catch (error) {

      console.error(
        'Reset Password Error:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Something went wrong',

        error:
          error.message,

      });
    }
  },


  // ============================================================
  // GET LOGGED-IN USER
  // ============================================================

  getMe: async (req, res) => {

    try {

      const user =
        await User.findById(
          req.user.id
        ).select(
          '-password -otp -otpExpires'
        );


      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }


      return res.status(200).json({

        success: true,

        data:
          user,

      });


    } catch (error) {

      console.error(
        'Get Me Error:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Something went wrong',

        error:
          error.message,

      });
    }
  },


  // ============================================================
  // CHANGE PASSWORD
  // ============================================================

  changePassword: async (req, res) => {

    try {

      const required = [
        'oldPassword',
        'newPassword',
        
      ];


      if (
        validate(
          req,
          res,
          required
        )
      ) {
        return;
      }


      const {
        oldPassword,
        newPassword,
  
      } = req.body;


      const userId =
        req.user.id;


      


      const user =
        await User.findById(
          userId
        );


      if (!user) {

        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }


      const isMatch =
        await bcrypt.compare(
          oldPassword,
          user.password
        );


      if (!isMatch) {

        return res.status(400).json({
          success: false,
          message:
            'Old password is incorrect',
        });
      }


      user.password =
        await bcrypt.hash(
          newPassword,
          12
        );


      await user.save();


      return res.status(200).json({

        success: true,

        message:
          'Password changed successfully',

      });


    } catch (error) {

      console.error(
        'Change Password Error:',
        error
      );


      return res.status(500).json({

        success: false,

        message:
          'Something went wrong',

        error:
          error.message,

      });
    }
  },


  // ============================================================
  // LOGOUT
  // ============================================================

 logout: async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      // Decode token to get expiry
      const decoded = jwt.decode(token);

      await TokenBlacklist.create({
        token,
        expiresAt: new Date(decoded.exp * 1000), // token expiry time
      });
    }

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: error.message,
    });
  }
},

};