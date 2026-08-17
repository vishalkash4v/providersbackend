const mongoose = require('mongoose');

/*
|--------------------------------------------------------------------------
| Location Schema
|--------------------------------------------------------------------------
| GeoJSON Point format:
|
| {
|   type: 'Point',
|   coordinates: [longitude, latitude],
|   name: 'Una, Himachal Pradesh, India'
| }
|
| The complete location field is optional.
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

    role: {
      type: Number,
      enum: [0, 1, 2],
      default: 0,

      // 0 = Customer
      // 1 = Provider
      // 2 = Admin
    },


    // ===================== LOCATION =====================

    /*
     * IMPORTANT:
     *
     * Location is completely optional.
     *
     * If the user does not provide location:
     *
     * location will NOT be created.
     *
     * If provided:
     *
     * location: {
     *   type: 'Point',
     *   coordinates: [longitude, latitude],
     *   name: 'Una, Himachal Pradesh, India'
     * }
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
     * User who referred this user.
     *
     * This stores the referrer's MongoDB _id,
     * NOT their referral code.
     */

    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },


    // ===================== VERIFICATION =====================

    isVerified: {
      type: Boolean,
      default: false,
    },

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
| This allows future queries like:
|
| Find providers within 10 KM.
|
| IMPORTANT:
| Documents without location are completely fine.
|--------------------------------------------------------------------------
*/

userSchema.index({
  location: '2dsphere',
});


const User = mongoose.model('User', userSchema);

module.exports = User;