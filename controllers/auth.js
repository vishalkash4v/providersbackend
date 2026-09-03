const User = require('../models/User');
const bcrypt = require('bcryptjs');
const { uploadSingleFile } = require('../utils/r2uploads');
const { notifyUser } = require('../utils/notification');
const {
  generateToken,
} = require('../middleware/jwt');
const Notification = require('../models/Notification'); // Top par import zaroor check kar lena
const { addBookingCredits } = require('../utils/bookingCredits');
const sendEmail = require('../utils/sendEmail');
const ProviderProfile = require('../models/ProviderProfile');
const Policy = require('../models/Policy');
const Kyc = require('../models/Kyc');
const {
  validate,
} = require('../utils/fieldValidations');
const axios = require("axios");

const MSG91_AUTH_KEY = process.env.MSG91_AUTH_KEY;
const sendSms = require('../utils/sendSms');

const {
  generateReferralCode,
} = require('../utils/referral');
const Referral = require('../models/Referral');
const {
  saveUserDevice,
} = require('../utils/device');
const jwt = require('jsonwebtoken');
const TokenBlacklist = require('../models/TokenBlacklist');

const Support = require('../models/Support');

module.exports = {

// ============================================================
  // REGISTER API
  // ============================================================
  register: async (req, res) => {
    try {
      const required = [
        'firstName',
        'lastName',
        'mobile',
        'email',
        'password',
        'role',
      ];

      if (validate(req, res, required)) return;

      const {
        firstName,
        lastName,
        mobile,
        email,
        password,
        role,
        latitude,
        longitude,
        locationName,
        referralCode: enteredReferralCode,
        profileImage,
        countryCode, // <--- Extracted
        deviceToken,
        deviceType = 0,
      } = req.body;

      const normalizedEmail = email.trim().toLowerCase();
      const normalizedMobile = mobile.trim();
      const normalizedCountryCode = countryCode ? countryCode.trim() : '+91'; // Fallback to default
      const normalizedDeviceType = Number(deviceType);

      if (![0, 1].includes(normalizedDeviceType)) {
        return res.status(400).json({ success: false, message: 'Invalid device type. Use 0 for Android or 1 for iOS' });
      }

      const existingEmailUser = await User.findOne({ email: normalizedEmail });
      const existingMobileUser = await User.findOne({ mobile: normalizedMobile });

      if (existingEmailUser && existingEmailUser.isVerified) {
        return res.status(400).json({ success: false, message: 'Email already registered' });
      }

      if (existingMobileUser && existingMobileUser.isVerified) {
        return res.status(400).json({ success: false, message: 'Mobile number already registered' });
      }

      if (
        existingEmailUser &&
        existingMobileUser &&
        existingEmailUser._id.toString() !== existingMobileUser._id.toString()
      ) {
        return res.status(400).json({ success: false, message: 'Email and Mobile number are associated with different accounts' });
      }

      const existingUser = existingEmailUser || existingMobileUser;

      let referredBy = existingUser?.referredBy || null;

      if (enteredReferralCode && enteredReferralCode.trim() !== '') {
        const normalizedReferralCode = enteredReferralCode.trim().toUpperCase();
        const referringUser = await User.findOne({ referralCode: normalizedReferralCode, isActive: true });

        if (!referringUser) return res.status(400).json({ success: false, message: 'Invalid referral code' });
        if (existingUser && referringUser._id.toString() === existingUser._id.toString()) {
          return res.status(400).json({ success: false, message: 'You cannot use your own referral code' });
        }
        referredBy = referringUser._id;
      }

      let location = existingUser?.location || null;
      const hasLatitude = latitude !== undefined && latitude !== null && latitude !== '';
      const hasLongitude = longitude !== undefined && longitude !== null && longitude !== '';
      const hasLocationName = locationName && locationName.trim() !== '';

      if (hasLatitude || hasLongitude || hasLocationName) {
        if (!hasLatitude || !hasLongitude) {
          return res.status(400).json({ success: false, message: 'Both latitude and longitude are required when providing location' });
        }

        const lat = Number(latitude);
        const lng = Number(longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ success: false, message: 'Latitude and longitude must be valid numbers' });
        if (lat < -90 || lat > 90) return res.status(400).json({ success: false, message: 'Latitude must be between -90 and 90' });
        if (lng < -180 || lng > 180) return res.status(400).json({ success: false, message: 'Longitude must be between -180 and 180' });

        location = { type: 'Point', coordinates: [lng, lat] };
        if (hasLocationName) location.name = locationName.trim();
      }

      const finalProfileImage = profileImage || existingUser?.profileImage || '';
      const hashedPassword = await bcrypt.hash(password, 12);
      const otp = Math.floor(1000 + Math.random() * 9000).toString();
      const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

      // ============================================================
      // EXISTING UNVERIFIED USER UPDATE
      // ============================================================
      if (existingUser) {
        existingUser.firstName = firstName.trim();
        existingUser.lastName = lastName.trim();
        existingUser.mobile = normalizedMobile;
        existingUser.countryCode = normalizedCountryCode; // <--- Saved
        existingUser.email = normalizedEmail;
        existingUser.password = hashedPassword;
        existingUser.role = Number(role);
        existingUser.referredBy = referredBy;
        existingUser.profileImage = finalProfileImage;
        existingUser.otp = otp;
        existingUser.otpExpires = otpExpires;
        existingUser.otpType = 0;
        existingUser.otpVerified = false;
        existingUser.isVerified = false;

        if (location) existingUser.location = location;
        await existingUser.save();

        if (Number(existingUser.role) === 1 && referredBy) {
          const referringUser = await User.findById(referredBy).select('_id role');
          if (referringUser && Number(referringUser.role) === 1) {
            const existingReferral = await Referral.findOne({ referredProvider: existingUser._id });
            if (!existingReferral) {
              await Referral.create({
                referrer: referringUser._id,
                referredProvider: existingUser._id,
                referralCode: enteredReferralCode.trim().toUpperCase(),
                status: 'PENDING',
                rewardCredits: 0,
              });
            }
          }
        }

        await saveUserDevice({ userId: existingUser._id, deviceToken, deviceType: normalizedDeviceType });

        await sendEmail({
          email: existingUser.email,
          subject: 'OTP Verification - Provider App',
          html: `<h2>Hello ${existingUser.firstName},</h2><p>Your new OTP for verification is:</p><h1 style="letter-spacing: 5px;">${otp}</h1><p>This OTP is valid for 10 minutes.</p>`,
        });

        const token = generateToken(existingUser);

        return res.status(200).json({
          success: true,
          message: 'Registration details updated. New OTP sent to your email.',
          token,
          data: {
            userId: existingUser._id,
            firstName: existingUser.firstName,
            lastName: existingUser.lastName,
            email: existingUser.email,
            countryCode: existingUser.countryCode, // <--- Returned
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
      let userReferralCode;
      while (true) {
        userReferralCode = generateReferralCode();
        const exists = await User.findOne({ referralCode: userReferralCode });
        if (!exists) break;
      }

      const userData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        mobile: normalizedMobile,
        countryCode: normalizedCountryCode, // <--- Saved
        email: normalizedEmail,
        password: hashedPassword,
        role: Number(role),
        referralCode: userReferralCode,
        referredBy,
        profileImage: finalProfileImage,
        profileImageHistory: [],
        otp,
        otpExpires,
        otpType: 0,
        otpVerified: false,
        isVerified: false,
      };

      if (location) userData.location = location;
      const user = await User.create(userData);

      if (Number(user.role) === 1 && referredBy) {
        const referringUser = await User.findById(referredBy).select('_id role');
        if (referringUser && Number(referringUser.role) === 1) {
          await Referral.create({
            referrer: referringUser._id,
            referredProvider: user._id,
            referralCode: enteredReferralCode.trim().toUpperCase(),
            status: 'PENDING',
            rewardCredits: 0,
          });
        }
      }

      await saveUserDevice({ userId: user._id, deviceToken, deviceType: normalizedDeviceType });

      await sendEmail({
        email: user.email,
        subject: 'OTP Verification - Provider App',
        html: `<h2>Hello ${user.firstName},</h2><p>Your OTP for verification is:</p><h1 style="letter-spacing: 5px;">${otp}</h1><p>This OTP is valid for 10 minutes.</p>`,
      });

      const token = generateToken(user);

      return res.status(201).json({
        success: true,
        message: 'Registration successful. OTP sent to your email.',
        token,
        data: {
          userId: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          countryCode: user.countryCode, // <--- Returned
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
      if (error.code === 11000) {
        return res.status(400).json({ success: false, message: 'Email or Mobile number already registered' });
      }
      return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
  },

  // ============================================================
  // UPDATE PROFILE API
  // ============================================================
  updateProfile: async (req, res) => {
    try {
      const userId = req.user.id;

      if (!userId) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
      }

      const {
        firstName,
        lastName,
        mobile,
        countryCode, // <--- Extracted
        email,
        latitude,
        longitude,
        locationName,
        profileImage,
      } = req.body;

      const user = await User.findById(userId);

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      if (email !== undefined) {
        if (!email || !email.trim()) return res.status(400).json({ success: false, message: 'Email is required' });
        const normalizedEmail = email.trim().toLowerCase();
        const existingEmail = await User.findOne({ email: normalizedEmail, _id: { $ne: userId } });
        if (existingEmail) return res.status(400).json({ success: false, message: 'Email already registered' });
        user.email = normalizedEmail;
      }

      if (mobile !== undefined) {
        const normalizedMobile = mobile.trim();
        if (!/^[0-9]{10}$/.test(normalizedMobile)) return res.status(400).json({ success: false, message: 'Please enter a valid 10 digit mobile number' });
        const existingMobile = await User.findOne({ mobile: normalizedMobile, _id: { $ne: userId } });
        if (existingMobile) return res.status(400).json({ success: false, message: 'Mobile number already registered' });
        user.mobile = normalizedMobile;
      }

      if (countryCode !== undefined) {
        user.countryCode = countryCode.trim(); // <--- Saved
      }

      if (firstName !== undefined) {
        if (!firstName.trim()) return res.status(400).json({ success: false, message: 'First name is required' });
        user.firstName = firstName.trim();
      }

      if (lastName !== undefined) {
        if (!lastName.trim()) return res.status(400).json({ success: false, message: 'Last name is required' });
        user.lastName = lastName.trim();
      }

      let imageUpdateMessage = '';
      if (profileImage !== undefined && profileImage.trim() !== '') {
        if (!user.profileImageHistory) user.profileImageHistory = [];

        if (Number(user.role) === 1) {
          user.profileImageHistory.push({
            image: profileImage.trim(),
            status: 0,
            submittedAt: new Date()
          });
          imageUpdateMessage = ' Your new profile picture is under review by the admin.';
        } else {
          user.profileImage = profileImage.trim();
          user.profileImageHistory.push({
            image: profileImage.trim(),
            status: 1,
            submittedAt: new Date(),
            reviewedAt: new Date()
          });
        }
      }

      const hasLatitude = latitude !== undefined && latitude !== null && latitude !== '';
      const hasLongitude = longitude !== undefined && longitude !== null && longitude !== '';
      const hasLocationName = locationName && locationName.trim() !== '';

      if (hasLatitude || hasLongitude || hasLocationName) {
        const existingLocation = user.location;
        let lat = existingLocation?.coordinates?.[1];
        let lng = existingLocation?.coordinates?.[0];

        if (hasLatitude) lat = Number(latitude);
        if (hasLongitude) lng = Number(longitude);

        if (lat === undefined || lat === null || lng === undefined || lng === null) return res.status(400).json({ success: false, message: 'Both latitude and longitude are required when providing location' });
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ success: false, message: 'Latitude and longitude must be valid numbers' });
        if (lat < -90 || lat > 90) return res.status(400).json({ success: false, message: 'Latitude must be between -90 and 90' });
        if (lng < -180 || lng > 180) return res.status(400).json({ success: false, message: 'Longitude must be between -180 and 180' });

        user.location = { type: 'Point', coordinates: [lng, lat] };
        if (hasLocationName) {
          user.location.name = locationName.trim();
        } else if (existingLocation?.name) {
          user.location.name = existingLocation.name;
        }
      }

      await user.save();

      let hasWorkDetails = false;
      if (Number(user.role) === 1) {
        const providerProfile = await ProviderProfile.findOne({ user: user._id }).select('_id services').lean();
        hasWorkDetails = !!providerProfile && Array.isArray(providerProfile.services) && providerProfile.services.length > 0;
      }

      return res.status(200).json({
        success: true,
        message: `Profile updated successfully.${imageUpdateMessage}`,
        data: {
          userId: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          countryCode: user.countryCode, // <--- Returned
          mobile: user.mobile,
          role: user.role,
          referralCode: user.referralCode,
          referredBy: user.referredBy,
          profileImage: user.profileImage,
          latestPendingImage: Number(user.role) === 1 && user.profileImageHistory?.length > 0
            ? user.profileImageHistory.slice(-1)[0]
            : null,
          location: user.location || null,
          isVerified: user.isVerified,
          hasWorkDetails
        },
      });
    } catch (error) {
      console.error('Update Profile Error:', error);
      return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
  },
  // ============================================================
  // ============================================================
  // LOGIN
  // ============================================================

  login: async (req, res) => {
    try {
      // ============================================================
      // REQUIRED FIELDS
      // ============================================================

      const required = [
        'email',
        'password',
      ];

      if (validate(req, res, required)) {
        return;
      }

      // ============================================================
      // REQUEST DATA
      // ============================================================

      const {
        email,
        password,

        // Optional device fields
        deviceToken,

        // 0 = Android
        // 1 = iOS
        // Default = Android
        deviceType = 0,
      } = req.body;

      // ============================================================
      // DEVICE TYPE VALIDATION
      // ============================================================

      const normalizedDeviceType =
        Number(deviceType);

      if (![0, 1].includes(normalizedDeviceType)) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid device type. Use 0 for Android or 1 for iOS',
        });
      }

      // ============================================================
      // FIND USER
      // ============================================================

      const user =
        await User.findOne({
          email:
            email
              .trim()
              .toLowerCase(),
        });

      if (!user) {
        return res.status(401).json({
          success: false,
          message:
            'Invalid email or password',
        });
      }

      // ============================================================
      // VERIFY ACCOUNT
      // ============================================================

      if (!user.isVerified) {
        return res.status(401).json({
          success: false,
          message:
            'Please verify your account first',
        });
      }

      // ============================================================
      // ACTIVE ACCOUNT CHECK
      // ============================================================

      if (!user.isActive) {
        return res.status(401).json({
          success: false,
          message:
            'Your account has been deactivated',
        });
      }

      // ============================================================
      // PASSWORD CHECK
      // ============================================================

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

      // ============================================================
      // PROVIDER WORK DETAILS CHECK
      //
      // role:
      // 0 = Customer
      // 1 = Provider
      //
      // hasWorkDetails:
      // true  = Provider has at least one service
      // false = No services added
      // ============================================================

      let hasWorkDetails = false;

      if (Number(user.role) === 1) {
        const providerProfile =
          await ProviderProfile.findOne({
            user: user._id,
          })
            .select('_id services')
            .lean();

        hasWorkDetails =
          !!providerProfile &&
          Array.isArray(providerProfile.services) &&
          providerProfile.services.length > 0;
      }

      // ============================================================
      // SAVE / UPDATE DEVICE
      // ============================================================

      await saveUserDevice({
        userId: user._id,
        deviceToken,
        deviceType:
          normalizedDeviceType,
      });

      // ============================================================
      // GENERATE TOKEN
      // ============================================================

      const token =
        generateToken(user);



      // ============================================================
      // RESPONSE
      // ============================================================

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
            user.location ||
            null,

          profileImage:
            user.profileImage,

          isVerified:
            user.isVerified,

          isActive:
            user.isActive,

          hasWorkDetails,
          bookingCredits:
            Number(user.bookingCredits || 0),

          bookingCreditsTotal:
            Number(user.bookingCreditsTotal || 0),
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
  // VERIFY OTP
  // type: 0 = Registration
  // type: 1 = Forgot Password
  // ============================================================

  verifyOtp: async (req, res) => {
    try {
      const required = [
        'email',
        'otp',
        'type',
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
        type,
      } = req.body;

      const otpType =
        Number(type);

      // ====================== VALIDATE TYPE ======================
      if (
        ![0, 1].includes(
          otpType
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid OTP type. Use 0 for registration or 1 for forgot password',
        });
      }

      const normalizedEmail =
        email
          .trim()
          .toLowerCase();

      // ====================== FIND USER ======================
      const user =
        await User.findOne({
          email:
            normalizedEmail,
        });

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }

      // ============================================================
      // REGISTRATION OTP
      // ============================================================
      if (otpType === 0) {
        if (user.isVerified) {
          return res.status(400).json({
            success: false,
            message:
              'User already verified',
          });
        }
      }

      // ============================================================
      // FORGOT PASSWORD OTP
      // ============================================================
      if (otpType === 1) {
        if (!user.isVerified) {
          return res.status(400).json({
            success: false,
            message:
              'Please verify your account first',
          });
        }
      }

      // ====================== CHECK OTP TYPE ======================
      if (
        user.otpType === undefined ||
        user.otpType === null ||
        Number(user.otpType) !==
        otpType
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid or expired OTP',
        });
      }

      // ====================== CHECK OTP ======================
      if (
        String(user.otp) !==
        String(otp)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid OTP',
        });
      }

      // ====================== CHECK EXPIRY ======================
      if (
        !user.otpExpires ||
        user.otpExpires <
        new Date()
      ) {
        return res.status(400).json({
          success: false,
          message:
            'OTP has expired',
        });
      }

      // ============================================================
      // REGISTRATION OTP VERIFIED
      // ============================================================
      if (otpType === 0) {
        user.isVerified =
          true;

        user.otpVerified =
          false;

        user.otp =
          undefined;

        user.otpExpires =
          undefined;

        user.otpType =
          null;

        await user.save();

        if (Number(user.role) === 1) {
          const welcomeBonus = Number(process.env.PROVIDER_WELCOME_CREDITS || 0);
          if (welcomeBonus > 0) {
            await addBookingCredits({
              providerId: user._id,
              amount: welcomeBonus,
              type: 'WELCOME_BONUS',
              description: 'Free credits on successful registration',
            });
          }
        }

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
      }

      // ============================================================
      // FORGOT PASSWORD OTP VERIFIED
      // ============================================================
      if (otpType === 1) {
        user.otpVerified =
          true;

        // Keep OTP type so resetPassword knows
        // this verification belongs to forgot password.
        user.otpType =
          1;

        // OTP itself can be removed after successful
        // verification because otpVerified is now true.
        user.otp =
          undefined;

        user.otpExpires =
          undefined;

        await user.save();

        return res.status(200).json({
          success: true,
          message:
            'OTP verified successfully. You can now reset your password.',
        });
      }

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
  // Registration OTP only
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

      const normalizedEmail =
        email
          .trim()
          .toLowerCase();

      const user =
        await User.findOne({
          email:
            normalizedEmail,
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
          Math.random() *
          9000
        ).toString();

      const otpExpires =
        new Date(
          Date.now() +
          10 * 60 * 1000
        );

      // Registration OTP
      user.otp =
        otp;

      user.otpExpires =
        otpExpires;

      user.otpType =
        0;

      user.otpVerified =
        false;

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

      const normalizedEmail =
        email
          .trim()
          .toLowerCase();

      const user =
        await User.findOne({
          email:
            normalizedEmail,
        });

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }

      // Only verified users can use forgot password
      if (!user.isVerified) {
        return res.status(400).json({
          success: false,
          message:
            'Please verify your account first',
        });
      }

      // ====================== GENERATE OTP ======================
      const otp =
        Math.floor(
          1000 +
          Math.random() *
          9000
        ).toString();

      const otpExpires =
        new Date(
          Date.now() +
          10 * 60 * 1000
        );

      // Forgot password OTP
      user.otp =
        otp;

      user.otpExpires =
        otpExpires;

      user.otpType =
        1;

      user.otpVerified =
        false;

      await user.save();

      // ====================== SEND EMAIL ======================
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
  // No OTP here.
  // OTP must be verified through /verify-otp with type = 1
  // ============================================================

  resetPassword: async (req, res) => {
    try {
      const required = [
        'email',
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
        newPassword,
      } = req.body;

      const normalizedEmail =
        email
          .trim()
          .toLowerCase();

      const user =
        await User.findOne({
          email:
            normalizedEmail,
        });

      if (!user) {
        return res.status(404).json({
          success: false,
          message:
            'User not found',
        });
      }

      // ============================================================
      // CHECK FORGOT PASSWORD OTP VERIFICATION
      // ============================================================

      if (
        user.otpVerified !== true ||
        Number(user.otpType) !== 1
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Please verify the OTP first',
        });
      }

      // ====================== UPDATE PASSWORD ======================
      user.password =
        await bcrypt.hash(
          newPassword,
          12
        );

      // ====================== CLEAR OTP STATE ======================
      user.otp =
        undefined;

      user.otpExpires =
        undefined;

      user.otpType =
        null;

      user.otpVerified =
        false;

      await user.save();

      // ====================== FRESH JWT ======================
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
      // Added .lean() to allow direct modification of the user object
      const user = await User.findById(req.user.id)
        .select('-password -otp -otpExpires')
        .lean();

      if (!user) {
        return res.status(404).json({ success: false, message: 'User not found' });
      }

      // ====================== HAS WORK DETAILS CHECK ======================
      let hasWorkDetails = false;
      if (Number(user.role) === 1) {
        const providerProfile = await ProviderProfile.findOne({ user: user._id }).select('_id services').lean();
        hasWorkDetails = !!providerProfile && Array.isArray(providerProfile.services) && providerProfile.services.length > 0;
      }
      user.hasWorkDetails = hasWorkDetails;

      // ====================== 1. KYC VERIFICATION STATUS ======================
      // Find the most recent KYC record for this user
      const kycRecord = await Kyc.findOne({ user: user._id }).sort({ createdAt: -1 }).lean();

      user.kycVerification = {
        // Status keys: 0 = Not Submitted, 1 = Submitted(Pending), 2 = Approved, 3 = Rejected
        status: kycRecord ? kycRecord.status : 0,
        rejectionReason: kycRecord?.rejectionReason || null,
        documentType: kycRecord?.documentType || null
      };

      // ====================== 2. IMAGE VERIFICATION STATUS ======================
      user.imageVerification = {
        status: 0,
        rejectionReason: null,
        latestImage: user.profileImage || null
      };

      // Check profile image history array (Most recent upload is at the end of the array)
      if (user.profileImageHistory && user.profileImageHistory.length > 0) {
        const latestImageUpdate = user.profileImageHistory[user.profileImageHistory.length - 1];

        user.imageVerification = {
          // Status keys: 0 = Pending, 1 = Approved, 2 = Rejected
          status: latestImageUpdate.status,
          rejectionReason: latestImageUpdate.rejectionReason || null,
          latestImage: latestImageUpdate.image
        };
      } else if (user.profileImage) {
        // If user has an image but no history (e.g. Customers or legacy users)
        user.imageVerification.status = 1; // Mark as auto-approved
      }

      // Optional: Remove the raw history array from response to keep payload clean
      delete user.profileImageHistory;

      // ====================== RESPONSE ======================
      return res.status(200).json({
        success: true,
        data: user,
      });

    } catch (error) {
      console.error('Get Me Error:', error);
      return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
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

      // Frontend se logout ke time fcm token lenge
      const { deviceToken } = req.body;

      if (token) {
        // Decode token to get expiry
        const decoded = jwt.decode(token);
        if (decoded && decoded.exp) {
          await TokenBlacklist.create({
            token,
            expiresAt: new Date(decoded.exp * 1000),
          });
        }
      }

      // 👇 NAYA CODE: Device Deactivation 👇
      if (deviceToken) {
        await removeUserDevice({
          userId: req.user.id,
          deviceToken: deviceToken
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Logged out successfully',
      });

    } catch (error) {
      console.error('Logout Error:', error);
      return res.status(500).json({
        success: false, message: 'Something went wrong', error: error.message,
      });
    }
  },



  //Common
  // ============================================================
  // GET USER/PROVIDER NOTIFICATIONS
  // ============================================================
  getNotifications: async (req, res) => {
    try {
      const userId = req.user.id;

      // 1. Fetch notifications with strictPopulate: false
      let notifications = await Notification.find({ user: userId })
        .populate({
          path: 'bookingId',
          model: 'Booking',
          select: 'service',
          strictPopulate: false,
          populate: {
            path: 'service',
            model: 'Service',
            select: 'image',
            strictPopulate: false
          }
        })
        .populate({
          path: 'booking',
          model: 'Booking',
          select: 'service',
          strictPopulate: false,
          populate: {
            path: 'service',
            model: 'Service',
            select: 'image',
            strictPopulate: false
          }
        })
        .sort({ createdAt: -1 })
        .limit(50)
        .lean();

      // 2. Map through the array, inject `serviceImage`, and delete useless keys
      notifications = notifications.map(notif => {
        let serviceImage = null;

        if (notif.bookingId && notif.bookingId.service && notif.bookingId.service.image) {
          serviceImage = notif.bookingId.service.image;
        } else if (notif.booking && notif.booking.service && notif.booking.service.image) {
          serviceImage = notif.booking.service.image;
        }

        const cleanedBookingId = notif.bookingId
          ? (notif.bookingId._id || notif.bookingId)
          : (notif.booking ? (notif.booking._id || notif.booking) : null);

        const finalNotif = { ...notif, serviceImage };

        if (finalNotif.bookingId) finalNotif.bookingId = cleanedBookingId;
        if (finalNotif.booking) finalNotif.booking = cleanedBookingId;

        // 👇 YAHAN FALTU KEYS KO HATA DIYA GAYA HAI 👇
        delete finalNotif.proposal;
        delete finalNotif.service;
        delete finalNotif.distanceInKm;

        return finalNotif;
      });

      return res.status(200).json({
        success: true,
        message: 'Notifications fetched successfully',
        data: notifications
      });

    } catch (error) {
      console.error('Fetch Notifications Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message
      });
    }
  },

  // ============================================================
  // MARK A SINGLE NOTIFICATION AS READ (Read One)
  // ============================================================
  markNotificationAsRead: async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      // Read One
      const notification = await Notification.findOneAndUpdate(
        { _id: id, user: userId },
        { $set: { isRead: true, readAt: new Date() } }, // 👉 Yahan readAt add kar diya
        { returnDocument: 'after' }
      );

      if (!notification) {
        return res.status(404).json({ success: false, message: 'Notification not found' });
      }

      return res.status(200).json({
        success: true,
        message: 'Notification marked as read',
        data: notification
      });
    } catch (error) {
      console.error('Mark Notification As Read Error:', error);
      return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
  },

  // ============================================================
  // MARK ALL USER NOTIFICATIONS AS READ (Read All)
  // ============================================================
  markAllNotificationsAsRead: async (req, res) => {
    try {
      const userId = req.user.id;

      // Read All
      await Notification.updateMany(
        { user: userId, isRead: false },
        { $set: { isRead: true, readAt: new Date() } }   // 👉 Yahan bhi readAt add kar diya
      );

      return res.status(200).json({
        success: true,
        message: 'All notifications marked as read'
      });
    } catch (error) {
      console.error('Mark All Notifications As Read Error:', error);
      return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
  },

  // ============================================================
  // DELETE SINGLE NOTIFICATION
  // ============================================================
  deleteNotification: async (req, res) => {
    try {
      const { notificationId } = req.params;

      // Notification dhoondo aur delete karo, par ensure karo ki wo ishi user ki ho
      const notification = await Notification.findOneAndDelete({
        _id: notificationId,
        user: req.user.id
      });

      if (!notification) {
        return res.status(404).json({
          success: false,
          message: 'Notification not found'
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Notification deleted successfully'
      });

    } catch (error) {
      console.error('Delete Notification Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message
      });
    }
  },

  // ============================================================
  // CLEAR ALL NOTIFICATIONS (Delete All)
  // ============================================================
  clearAllNotifications: async (req, res) => {
    try {
      // Is user ki saari notifications DB se uda do
      await Notification.deleteMany({ user: req.user.id });

      return res.status(200).json({
        success: true,
        message: 'All notifications cleared successfully'
      });

    } catch (error) {
      console.error('Clear All Notifications Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message
      });
    }
  },

  createSupportTicket: async (req, res) => {
    try {
      const { subject, description } = req.body;

      if (!subject || !description) {
        return res.status(400).json({
          success: false,
          message: 'Subject and description are required'
        });
      }

      const supportTicket = await Support.create({
        user: req.user.id,
        subject: subject.trim(),
        description: description.trim(),
      });

      return res.status(201).json({
        success: true,
        message: 'Your support request has been submitted successfully. Our team will contact you shortly.',
        // data: supportTicket
      });
    } catch (error) {
      console.error('Create Support Ticket Error:', error);
      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message
      });
    }
  },
  getPolicyByType: async (req, res) => {
    try {
      const { type } = req.params; // Pass 'TERMS' or 'PRIVACY' in the URL
      const policy = await Policy.findOne({ type: type.toUpperCase() }).lean();

      if (!policy) return res.status(404).json({ success: false, message: 'Policy not found' });

      return res.status(200).json({ success: true, data: policy });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  },

  deleteAccount: async (req, res) => {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);

      if (!user || user.deletedAt) {
        return res.status(404).json({ success: false, message: 'Account not found or already deleted' });
      }

      // ============================================================
      // SOFT DELETE & ANONYMIZATION LOGIC
      // ============================================================
      user.isActive = false;
      user.deletedAt = new Date();

      // Unique fields modify kar do taaki same number/email se naya account ban sake
      const timestamp = Date.now();
      if (user.email) user.email = `deleted_${timestamp}_${user.email}`;
      if (user.mobile) user.mobile = `N/A`;

      // Password hash hata do security ke liye
      user.password = `deleted_${timestamp}`;

      await user.save();

      // ============================================================
      // HIDE PROVIDER PROFILE (IF ROLE IS 1)
      // ============================================================
      if (Number(user.role) === 1) {
        await ProviderProfile.findOneAndUpdate(
          { user: userId },
          { $set: { isActive: false } }
        );
      }

      // Optional: Agar aapke paas TokenBlacklist ka logic hai, toh token ko invalidate kar do
      // const token = req.headers.authorization.split(' ')[1];
      // await TokenBlacklist.create({ token });

      return res.status(200).json({
        success: true,
        message: 'Your account has been deleted successfully.'
      });

    } catch (error) {
      console.error('Delete Account Error:', error);
      return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
  },

  testOtp: async (req, res) => {
    try {
      const mobile = "8219891913";
      const otp = "9898";
      await sendSms(mobile, otp);

      const response = await axios.post(
        "https://control.msg91.com/api/v5/flow",
        {
          flow_id: "6a9867549bffba00f082a12",
          sender: "smsind",
          recipients: [
            {
              mobiles: `91${mobile}`,
              OTP: otp
            }
          ]
        },
        {
          headers: {
            authkey: MSG91_AUTH_KEY,
            "Content-Type": "application/json"
          }
        }
      );

      console.log("MSG91 Response:", response.data);

      return res.status(200).json({
        success: true,
        msg91: response.data
      });

    } catch (error) {
      console.log(
        "MSG91 ERROR:",
        error.response?.data || error.message
      );

      return res.status(500).json({
        success: false,
        error: error.response?.data || error.message
      });
    }
  }

};