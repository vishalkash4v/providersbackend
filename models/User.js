const mongoose = require('mongoose');

/*
|--------------------------------------------------------------------------
| Location Schema
|--------------------------------------------------------------------------
| GeoJSON Point:
|
| {
|   type: 'Point',
|   coordinates: [longitude, latitude],
|   name: 'Una, Himachal Pradesh, India'
| }
|--------------------------------------------------------------------------
*/

const locationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['Point'],
      required: true,
    },

    coordinates: {
      type: [Number],
      required: true,

      validate: {
        validator: function (value) {
          if (!Array.isArray(value)) {
            return false;
          }

          if (value.length !== 2) {
            return false;
          }

          const [longitude, latitude] = value;

          return (
            typeof longitude === 'number' &&
            typeof latitude === 'number' &&
            longitude >= -180 &&
            longitude <= 180 &&
            latitude >= -90 &&
            latitude <= 90
          );
        },

        message:
          'Coordinates must be [longitude, latitude]',
      },
    },

    name: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
    id: false,
  }
);


/*
|--------------------------------------------------------------------------
| User Schema
|--------------------------------------------------------------------------
*/

const userSchema = new mongoose.Schema(
  {
    // ===================== BASIC DETAILS =====================

    firstName: {
      type: String,
      required: true,
      trim: true,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
    },

    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    password: {
      type: String,
      required: true,
    },


    // ===================== ROLE =====================

    /*
     * 0 = Customer
     * 1 = Provider
     * 2 = Admin
     */

    role: {
      type: Number,
      enum: [0, 1, 2],
      default: 0,
    },


    // ===================== LOCATION =====================

    /*
     * Completely optional.
     *
     * If not provided, location remains undefined.
     */

    location: {
      type: locationSchema,
      default: undefined,
    },


    // ===================== REFERRAL =====================

    /*
     * Every user gets their own unique referral code.
     */

    referralCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
      uppercase: true,
      trim: true,
    },

    /*
     * The user who referred this user.
     *
     * Stores MongoDB User _id.
     */

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },


    // ===================== BOOKING CREDITS =====================

    /*
     * Currently available booking credits.
     *
     * Example:
     *
     * bookingCredits = 52
     */

    bookingCredits: {
      type: Number,
      default: 0,
      min: 0,
    },

    /*
     * Total booking credits ever added.
     *
     * Example:
     *
     * Referral reward       +3
     * Subscription         +50
     *
     * bookingCreditsTotal = 53
     *
     * If provider uses 1 credit:
     *
     * bookingCredits      = 52
     * bookingCreditsTotal = 53
     */

    bookingCreditsTotal: {
      type: Number,
      default: 0,
      min: 0,
    },


    // ===================== VERIFICATION =====================

    isVerified: {
      type: Boolean,
      default: false,
    },

    /*
     * 0 = Registration OTP
     * 1 = Forgot Password OTP
     */

    otpType: {
      type: Number,
      enum: [0, 1],
      default: null,
    },

    otpVerified: {
      type: Boolean,
      default: false,
    },

    otp: {
      type: String,
    },

    otpExpires: {
      type: Date,
    },


    // ===================== PROFILE =====================

    profileImage: {
      type: String,
      default: null,
    },


    // ===================== STATUS =====================

    isActive: {
      type: Boolean,
      default: true,
    },
  },

  {
    timestamps: true,
  }
);


/*
|--------------------------------------------------------------------------
| GeoJSON Index
|--------------------------------------------------------------------------
|
| Allows queries such as:
|
| Find providers within 10 KM.
|
| Users without location are completely fine.
|--------------------------------------------------------------------------
*/

userSchema.index({
  location: '2dsphere',
});


const User = mongoose.model(
  'User',
  userSchema
);

module.exports = User;