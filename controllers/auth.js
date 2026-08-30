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
const {
  validate,
} = require('../utils/fieldValidations');

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
  // REGISTER
  // ============================================================

  register: async (req, res) => {
    try {
      // ============================================================
      // REQUIRED FIELDS
      // ============================================================

      const required = [
        'firstName',
        'lastName',
        'mobile',
        'email',
        'password',
        'role',
      ];

      if (validate(req, res, required)) return;

      // ============================================================
      // REQUEST DATA
      // ============================================================

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

        // ==========================================================
        // OPTIONAL DEVICE FIELDS
        // ==========================================================

        deviceToken,

        // 0 = Android
        // 1 = iOS
        // Default = Android
        deviceType = 0,
      } = req.body;

      // ============================================================
      // PASSWORD MATCH
      // ============================================================



      // ============================================================
      // NORMALIZE EMAIL / MOBILE
      // ============================================================

      const normalizedEmail =
        email.trim().toLowerCase();

      const normalizedMobile =
        mobile.trim();

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
      // FIND EXISTING USERS
      // ============================================================

      const existingEmailUser =
        await User.findOne({
          email: normalizedEmail,
        });

      const existingMobileUser =
        await User.findOne({
          mobile: normalizedMobile,
        });

      // ============================================================
      // VERIFIED EMAIL
      // ============================================================

      if (
        existingEmailUser &&
        existingEmailUser.isVerified
      ) {
        return res.status(400).json({
          success: false,
          message: 'Email already registered',
        });
      }

      // ============================================================
      // VERIFIED MOBILE
      // ============================================================

      if (
        existingMobileUser &&
        existingMobileUser.isVerified
      ) {
        return res.status(400).json({
          success: false,
          message: 'Mobile number already registered',
        });
      }

      // ============================================================
      // EMAIL AND MOBILE BELONG TO DIFFERENT USERS
      // ============================================================

      if (
        existingEmailUser &&
        existingMobileUser &&
        existingEmailUser._id.toString() !==
        existingMobileUser._id.toString()
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Email and Mobile number are associated with different accounts',
        });
      }

      // ============================================================
      // EXISTING UNVERIFIED USER
      // ============================================================

      const existingUser =
        existingEmailUser ||
        existingMobileUser;

      // ============================================================
      // REFERRAL
      // ============================================================

      let referredBy =
        existingUser?.referredBy || null;

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

        // User cannot refer himself
        if (
          existingUser &&
          referringUser._id.toString() ===
          existingUser._id.toString()
        ) {
          return res.status(400).json({
            success: false,
            message:
              'You cannot use your own referral code',
          });
        }

        referredBy =
          referringUser._id;
      }

      // ============================================================
      // LOCATION
      // ============================================================

      let location =
        existingUser?.location || null;

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

        location = {
          type: 'Point',
          coordinates: [
            lng,
            lat,
          ],
        };

        if (hasLocationName) {
          location.name =
            locationName.trim();
        }
      }

      // ============================================================
      // PROFILE IMAGE
      // ============================================================

      let profileImage =
        existingUser?.profileImage ||
        null;

      if (
        req.files &&
        req.files.profileImage
      ) {
        const uploaded =
          await uploadSingleFile(
            req,
            'profileImage',
            'uploads/profiles'
          );

        if (uploaded) {
          profileImage =
            uploaded.path;
        }
      }

      // ============================================================
      // PASSWORD
      // ============================================================

      const hashedPassword =
        await bcrypt.hash(
          password,
          12
        );

      // ============================================================
      // OTP
      // ============================================================

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

      // ============================================================
      // EXISTING UNVERIFIED USER
      // ============================================================

      if (existingUser) {
        existingUser.firstName =
          firstName.trim();

        existingUser.lastName =
          lastName.trim();

        existingUser.mobile =
          normalizedMobile;

        existingUser.email =
          normalizedEmail;

        existingUser.password =
          hashedPassword;

        existingUser.role =
          Number(role);

        existingUser.referredBy =
          referredBy;

        existingUser.profileImage =
          profileImage;

        // Registration OTP
        existingUser.otp =
          otp;

        existingUser.otpExpires =
          otpExpires;

        existingUser.otpType =
          0;

        existingUser.otpVerified =
          false;

        existingUser.isVerified =
          false;

        if (location) {
          existingUser.location =
            location;
        }

        await existingUser.save();


        // ============================================================
        // CREATE REFERRAL FOR EXISTING UNVERIFIED PROVIDER
        // ONLY IF REFERRAL DOES NOT ALREADY EXIST
        // ============================================================

        if (
          Number(existingUser.role) === 1 &&
          referredBy
        ) {
          const referringUser =
            await User.findById(referredBy)
              .select('_id role');

          if (
            referringUser &&
            Number(referringUser.role) === 1
          ) {
            const existingReferral =
              await Referral.findOne({
                referredProvider:
                  existingUser._id,
              });

            if (!existingReferral) {
              await Referral.create({
                referrer:
                  referringUser._id,

                referredProvider:
                  existingUser._id,

                referralCode:
                  enteredReferralCode
                    .trim()
                    .toUpperCase(),

                status:
                  'PENDING',

                rewardCredits:
                  0,
              });
            }
          }
        }
        // ==========================================================
        // SAVE / UPDATE DEVICE
        // ==========================================================

        await saveUserDevice({
          userId:
            existingUser._id,
          deviceToken,
          deviceType:
            normalizedDeviceType,
        });

        // ==========================================================
        // SEND OTP
        // ==========================================================

        await sendEmail({
          email:
            existingUser.email,

          subject:
            'OTP Verification - Provider App',

          html: `
          <h2>Hello ${existingUser.firstName},</h2>

          <p>Your new OTP for verification is:</p>

          <h1 style="letter-spacing: 5px;">
            ${otp}
          </h1>

          <p>
            This OTP is valid for 10 minutes.
          </p>
        `,
        });

        // ==========================================================
        // TOKEN
        // ==========================================================

        const token =
          generateToken(
            existingUser
          );

        // ==========================================================
        // RESPONSE
        // ==========================================================

        return res.status(200).json({
          success: true,
          message:
            'Registration details updated. New OTP sent to your email.',
          token,

          data: {
            userId:
              existingUser._id,

            firstName:
              existingUser.firstName,

            lastName:
              existingUser.lastName,

            email:
              existingUser.email,

            mobile:
              existingUser.mobile,

            role:
              existingUser.role,

            referralCode:
              existingUser.referralCode,

            referredBy:
              existingUser.referredBy,

            profileImage:
              existingUser.profileImage,

            location:
              existingUser.location ||
              null,

            isVerified:
              existingUser.isVerified,
          },
        });
      }

      // ============================================================
      // NEW USER
      // ============================================================

      // ============================================================
      // GENERATE UNIQUE REFERRAL CODE
      // ============================================================

      let userReferralCode;

      while (true) {
        userReferralCode =
          generateReferralCode();

        const exists =
          await User.findOne({
            referralCode:
              userReferralCode,
          });

        if (!exists) break;
      }

      // ============================================================
      // CREATE USER DATA
      // ============================================================

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

        referralCode:
          userReferralCode,

        referredBy,

        profileImage,

        // Registration OTP
        otp,

        otpExpires,

        otpType: 0,

        otpVerified: false,

        isVerified: false,
      };

      if (location) {
        userData.location =
          location;
      }

      // ============================================================
      // CREATE USER
      // ============================================================

      const user =
        await User.create(
          userData
        );

      // ============================================================
      // CREATE REFERRAL RECORD
      // ============================================================

      // ============================================================
      // CREATE PROVIDER -> PROVIDER REFERRAL
      // ============================================================

      if (
        Number(user.role) === 1 &&
        referredBy
      ) {
        const referringUser =
          await User.findById(referredBy)
            .select('_id role');

        // Referral is valid only when
        // Provider refers another Provider.
        if (
          referringUser &&
          Number(referringUser.role) === 1
        ) {
          await Referral.create({
            referrer:
              referringUser._id,

            referredProvider:
              user._id,

            referralCode:
              enteredReferralCode
                .trim()
                .toUpperCase(),

            status:
              'PENDING',

            rewardCredits:
              0,
          });
        }
      }

      // ============================================================
      // SAVE / UPDATE DEVICE
      // ============================================================

      await saveUserDevice({
        userId:
          user._id,

        deviceToken,

        deviceType:
          normalizedDeviceType,
      });

      // ============================================================
      // SEND OTP
      // ============================================================

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

      // ============================================================
      // TOKEN
      // ============================================================

      const token =
        generateToken(user);

      // ============================================================
      // RESPONSE
      // ============================================================

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

          referralCode:
            user.referralCode,

          referredBy:
            user.referredBy,

          profileImage:
            user.profileImage,

          location:
            user.location ||
            null,

          isVerified:
            user.isVerified,
        },
      });

    } catch (error) {
      console.error(
        'Register Error:',
        error
      );

      // ============================================================
      // DUPLICATE KEY
      // ============================================================

      if (error.code === 11000) {
        return res.status(400).json({
          success: false,
          message:
            'Email or Mobile number already registered',
        });
      }

      // ============================================================
      // ERROR
      // ============================================================

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
  // UPDATE PROFILE
  // ============================================================

  updateProfile: async (req, res) => {
    try {
      const userId =
        req.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message:
            'Unauthorized',
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

      // ====================== EMAIL ======================
      if (email !== undefined) {
        if (
          !email ||
          !email.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Email is required',
          });
        }

        const normalizedEmail =
          email
            .trim()
            .toLowerCase();

        const existingEmail =
          await User.findOne({
            email:
              normalizedEmail,
            _id: {
              $ne: userId,
            },
          });

        if (existingEmail) {
          return res.status(400).json({
            success: false,
            message:
              'Email already registered',
          });
        }

        user.email =
          normalizedEmail;
      }

      // ====================== MOBILE ======================
      if (mobile !== undefined) {
        const normalizedMobile =
          mobile.trim();

        if (
          !/^[0-9]{10}$/.test(
            normalizedMobile
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Please enter a valid 10 digit mobile number',
          });
        }

        const existingMobile =
          await User.findOne({
            mobile:
              normalizedMobile,
            _id: {
              $ne: userId,
            },
          });

        if (existingMobile) {
          return res.status(400).json({
            success: false,
            message:
              'Mobile number already registered',
          });
        }

        user.mobile =
          normalizedMobile;
      }

      // ====================== FIRST NAME ======================
      if (firstName !== undefined) {
        if (
          !firstName.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              'First name is required',
          });
        }

        user.firstName =
          firstName.trim();
      }

      // ====================== LAST NAME ======================
      if (lastName !== undefined) {
        if (
          !lastName.trim()
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Last name is required',
          });
        }

        user.lastName =
          lastName.trim();
      }

      // ====================== PROFILE IMAGE ======================
      if (
        req.files &&
        req.files.profileImage
      ) {
        const uploaded =
          await uploadSingleFile(
            req,
            'profileImage',
            'uploads/profiles'
          );

        if (uploaded) {
          user.profileImage =
            uploaded.path;
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

      if (
        hasLatitude ||
        hasLongitude ||
        hasLocationName
      ) {
        const existingLocation =
          user.location;

        let lat =
          existingLocation
            ?.coordinates?.[1];

        let lng =
          existingLocation
            ?.coordinates?.[0];

        if (hasLatitude) {
          lat =
            Number(latitude);
        }

        if (hasLongitude) {
          lng =
            Number(longitude);
        }

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

        user.location = {
          type: 'Point',
          coordinates: [
            lng,
            lat,
          ],
        };

        if (hasLocationName) {
          user.location.name =
            locationName.trim();
        } else if (
          existingLocation?.name
        ) {
          user.location.name =
            existingLocation.name;
        }
      }

      // ====================== SAVE ======================
      await user.save();

      // ====================== RESPONSE ======================
      return res.status(200).json({
        success: true,
        message:
          'Profile updated successfully',
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

          referralCode:
            user.referralCode,

          referredBy:
            user.referredBy,

          profileImage:
            user.profileImage,

          location:
            user.location || null,

          isVerified:
            user.isVerified,
        },
      });
    } catch (error) {
      console.error(
        'Update Profile Error:',
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
      const userId = req.user.id; // Token se user ID mil jayegi

      // Database se is user ki notifications nikalo (Latest sabse upar, max 50)
      const notifications = await Notification.find({ user: userId })
        .sort({ createdAt: -1 }) // Nayi notifications pehle aayengi
        .limit(50)               // Limit laga do taaki API fast rahe
        .lean();

      // Optional: Agar 'isRead' status update karna ho toh yahan kar sakte ho
      // await Notification.updateMany({ user: userId, isRead: false }, { $set: { isRead: true } });

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
            if (user.mobile) user.mobile = `deleted_${timestamp}_${user.mobile}`;
            
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
    }



};