const User = require('../models/User');
const bcrypt = require('bcryptjs');

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


module.exports = {

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

      if (validate(req, res, required)) {
        return;
      }


      const {
        firstName,
        lastName,
        mobile,
        email,
        password,
        confirmPassword,
        role,

        // Optional location
        latitude,
        longitude,
        locationName,

        // Optional referral code entered by new user
        referralCode: enteredReferralCode,

      } = req.body;


      // ========================================================
      // PASSWORD VALIDATION
      // ========================================================

      if (password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message:
            'Password and confirm password do not match',
        });
      }


      // ========================================================
      // CHECK EXISTING USER
      // ========================================================

      const normalizedEmail =
        email.trim().toLowerCase();

      const normalizedMobile =
        mobile.trim();


      const existingUser = await User.findOne({
        $or: [
          {
            email: normalizedEmail,
          },
          {
            mobile: normalizedMobile,
          },
        ],
      });


      if (existingUser) {
        return res.status(400).json({
          success: false,
          message:
            'Email or Mobile number already registered',
        });
      }


      // ========================================================
      // REFERRAL
      // ========================================================

      let referredBy = null;


      if (
        enteredReferralCode &&
        enteredReferralCode.trim() !== ''
      ) {

        const normalizedReferralCode =
          enteredReferralCode
            .trim()
            .toUpperCase();


        const referringUser =
          await User.findOne({
            referralCode:
              normalizedReferralCode,

            isActive: true,
          });


        if (!referringUser) {
          return res.status(400).json({
            success: false,
            message: 'Invalid referral code',
          });
        }


        referredBy =
          referringUser._id;
      }


      // ========================================================
      // GENERATE UNIQUE REFERRAL CODE FOR NEW USER
      // ========================================================

      let userReferralCode;


      while (true) {

        userReferralCode =
          generateReferralCode();


        const existingReferralCode =
          await User.findOne({
            referralCode:
              userReferralCode,
          });


        if (!existingReferralCode) {
          break;
        }
      }


      // ========================================================
      // HASH PASSWORD
      // ========================================================

      const hashedPassword =
        await bcrypt.hash(
          password,
          12
        );


      // ========================================================
      // GENERATE OTP
      // ========================================================

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


      // ========================================================
      // LOCATION
      // ========================================================

      /*
       * LOCATION IS COMPLETELY OPTIONAL.
       *
       * No latitude + no longitude
       * => location remains undefined.
       *
       * Therefore MongoDB will NOT receive:
       *
       * location: {}
       *
       * or
       *
       * location: { name: null }
       *
       * or
       *
       * location: { type: 'Point' }
       */


      let location;


      const hasLatitude =
        latitude !== undefined &&
        latitude !== null &&
        latitude !== '';


      const hasLongitude =
        longitude !== undefined &&
        longitude !== null &&
        longitude !== '';


      const hasLocationName =
        locationName !== undefined &&
        locationName !== null &&
        locationName.trim() !== '';


      // --------------------------------------------------------
      // If ANY location information is sent,
      // latitude + longitude must both be present.
      // --------------------------------------------------------

      if (
        hasLatitude ||
        hasLongitude ||
        hasLocationName
      ) {

        if (
          !hasLatitude ||
          !hasLongitude
        ) {

          return res.status(400).json({
            success: false,
            message:
              'Both latitude and longitude are required when providing location',
          });
        }


        const lat =
          Number(latitude);

        const lng =
          Number(longitude);


        // ------------------------------------------------------
        // Validate number
        // ------------------------------------------------------

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {

          return res.status(400).json({
            success: false,
            message:
              'Latitude and longitude must be valid numbers',
          });
        }


        // ------------------------------------------------------
        // Validate latitude
        // ------------------------------------------------------

        if (
          lat < -90 ||
          lat > 90
        ) {

          return res.status(400).json({
            success: false,
            message:
              'Latitude must be between -90 and 90',
          });
        }


        // ------------------------------------------------------
        // Validate longitude
        // ------------------------------------------------------

        if (
          lng < -180 ||
          lng > 180
        ) {

          return res.status(400).json({
            success: false,
            message:
              'Longitude must be between -180 and 180',
          });
        }


        // ------------------------------------------------------
        // Create valid GeoJSON Point
        //
        // IMPORTANT:
        // GeoJSON = [longitude, latitude]
        // ------------------------------------------------------

        location = {
          type: 'Point',

          coordinates: [
            lng,
            lat,
          ],
        };


        // Location name is optional
        if (hasLocationName) {
          location.name =
            locationName.trim();
        }
      }


      // ========================================================
      // CREATE USER
      // ========================================================

      const userData = {

        firstName:
          firstName.trim(),

        lastName:
          lastName.trim(),

        mobile:
          normalizedMobile,

        email:
          normalizedEmail,

        password:
          hashedPassword,

        role:
          Number(role),

        // New user's own referral code
        referralCode:
          userReferralCode,

        // Existing user who referred them
        referredBy:

          referredBy,

        otp,

        otpExpires,

        isVerified:
          false,
      };


      /*
       * VERY IMPORTANT:
       *
       * Only add location to userData if it actually exists.
       *
       * This prevents MongoDB from receiving
       * an incomplete GeoJSON object.
       */

      if (location) {
        userData.location =
          location;
      }


      const user =
        await User.create(
          userData
        );


      // ========================================================
      // SEND OTP
      // ========================================================

      await sendEmail({

        email:
          user.email,

        subject:
          'OTP Verification - Provider App',

        html: `
          <h2>Hello ${user.firstName},</h2>

          <p>Your OTP for verification is:</p>

          <h1 style="letter-spacing: 5px;">
            ${otp}
          </h1>

          <p>
            This OTP is valid for 10 minutes.
          </p>
        `,
      });


      // ========================================================
      // GENERATE JWT
      // ========================================================

      const token =
        generateToken(user);


      // ========================================================
      // RESPONSE
      // ========================================================

      return res.status(201).json({

        success: true,

        message:
          'Registration successful. OTP sent to your email.',

        token,

        data: {

          userId:
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

          // User's own referral code
          referralCode:
            user.referralCode,

          // Referrer user ID
          referredBy:
            user.referredBy,

          // Will be null/absent when no location
          location:
            user.location || null,

          isVerified:
            user.isVerified,

        },
      });


    } catch (error) {

      console.error(
        'Register Error:',
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
        'confirmPassword',
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
        confirmPassword,
      } = req.body;


      if (
        newPassword !==
        confirmPassword
      ) {

        return res.status(400).json({
          success: false,
          message:
            'Passwords do not match',
        });
      }


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
        'confirmPassword',
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
        confirmPassword,
      } = req.body;


      const userId =
        req.user.id;


      if (
        newPassword !==
        confirmPassword
      ) {

        return res.status(400).json({
          success: false,
          message:
            'New password and confirm password do not match',
        });
      }


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

      /*
       * JWT is stateless.
       *
       * For the current implementation,
       * logout is handled by the client removing
       * the stored token.
       *
       * If you later want server-side token
       * invalidation, we can add a token blacklist.
       */

      return res.status(200).json({

        success: true,

        message:
          'Logged out successfully',

      });


    } catch (error) {

      console.error(
        'Logout Error:',
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

};