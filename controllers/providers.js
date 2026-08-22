const ProviderProfile = require('../models/ProviderProfile');
const Service = require('../models/Service');
const User = require('../models/User'); // Required to fix the login location null issue
const Booking = require('../models/Booking');
const BookingOffer = require('../models/BookingOffer');
const Referral = require('../models/Referral');
const { validate } = require('../utils/fieldValidations');
const { calculateDistance } = require('../utils/distance');
module.exports = {


  // ============================================================
  // PROVIDER HOME DASHBOARD (ULTRA FAST)
  // ============================================================
  getProviderHome: async (req, res) => {
    try {
      const userId = req.user.id;

      // 1. Find what the provider has already offered on to exclude from new leads
      const offeredBookingIds = await BookingOffer.find({ provider: userId }).distinct('booking');

      // 2. Run all heavy DB queries concurrently for maximum speed
      const [
        providerUser,
        pendingReferrals,
        providerProfile,
        newBookings,
        sentOffers,         // Offers provider just sent (waiting for user, status: 0)
        actionRequiredOffers // Offers user accepted (waiting for provider, status: 1)
      ] = await Promise.all([
        User.findById(userId).select('bookingCredits bookingCreditsTotal').lean(),
        Referral.countDocuments({ referrer: userId, status: 'PENDING' }),
        ProviderProfile.findOne({ user: userId }).select('location').lean(),
        
        // NEW LEADS (Provider notified, but hasn't offered yet)
        Booking.find({
          notifiedProviders: userId,
          status: 0,
          deletedAt: null,
          _id: { $nin: offeredBookingIds } // Exclude if offer already made
        })
        .populate('service', 'name image')
        .populate('user', 'firstName lastName profileImage')
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),

        // NEW OFFERS (Sent by provider, pending user decision)
        BookingOffer.find({ provider: userId, status: 0 })
        .populate({
          path: 'booking',
          select: 'user service status address location deletedAt createdAt',
          populate: [
            { path: 'service', select: 'name image' },
            { path: 'user', select: 'firstName lastName profileImage' }
          ]
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),

        // PENDING OFFERS (User accepted, waiting for provider's final approval)
        BookingOffer.find({ provider: userId, status: 1 })
        .populate({
          path: 'booking',
          select: 'user service status address location deletedAt createdAt',
          populate: [
            { path: 'service', select: 'name image' },
            { path: 'user', select: 'firstName lastName profileImage' }
          ]
        })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean()
      ]);

      // 3. Dynamically calculate distances for new bookings (Offers already have distanceKm saved)
      if (providerProfile && providerProfile.location && providerProfile.location.coordinates) {
        const [pLng, pLat] = providerProfile.location.coordinates;
        
        newBookings.forEach(b => {
          if (b.location && b.location.coordinates) {
            const [bLng, bLat] = b.location.coordinates;
            b.distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
          }
        });
      }

      // 4. Calculate Stats
      const creditsTotal = Number(providerUser?.bookingCreditsTotal || 0);
      const creditsLeft = Number(providerUser?.bookingCredits || 0);
      const creditsUsed = Math.max(0, creditsTotal - creditsLeft);

      // 5. Response
      return res.status(200).json({
        success: true,
        message: 'Provider home fetched successfully',
        data: {
          stats: {
            freeBookingsLeft: creditsLeft,
            freeBookingsUsed: creditsUsed,
            freeBookingsTotal: creditsTotal,
            pendingReferrals: pendingReferrals
          },
          actionRequiredOffers: actionRequiredOffers, // Limit 5 (User accepted, you need to approve)
          newOffers: sentOffers,                      // Limit 5 (You offered, waiting for user)
          newBookings: newBookings                    // Limit 5 (New leads nearby)
        }
      });

    } catch (error) {
      console.error('Provider Home Error:', error);
      return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
  },

  // ============================================================
  // ADD / UPDATE PROVIDER WORK DETAILS
  // Supports JSON + multipart/form-data
  // ============================================================
  addWorkDetails: async (req, res) => {
    try {
      const required = [
        'services',
        'radius',
        'latitude',
        'longitude',
      ];

      if (validate(req, res, required)) return;

      const userId = req.user.id;

      let {
        services,
        radius,
        latitude,
        longitude,
        address,
        locationName, // Added locationName extraction
      } = req.body;

      // ============================================================
      // PARSE SERVICES
      // ============================================================
      if (typeof services === 'string') {
        try {
          services = JSON.parse(services);
        } catch (error) {
          // Support comma-separated values as fallback
          services = services
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean);
        }
      }

      // If only one service ID was sent
      if (!Array.isArray(services)) {
        services = [services];
      }

      // Remove empty values and duplicates
      services = [
        ...new Set(
          services
            .map((id) => String(id).trim())
            .filter(Boolean)
        ),
      ];

      // ============================================================
      // VALIDATE SERVICES
      // ============================================================
      if (!services.length) {
        return res.status(400).json({
          success: false,
          message: 'Please select at least one service',
        });
      }

      const validServices = await Service.find({
        _id: { $in: services },
        isActive: true,
      }).select('_id');

      if (validServices.length !== services.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more services are invalid or inactive',
        });
      }

      // ============================================================
      // PARSE NUMBERS
      // ============================================================
      const parsedRadius = Number(radius);
      const parsedLatitude = Number(latitude);
      const parsedLongitude = Number(longitude);

      // ============================================================
      // VALIDATE RADIUS
      // ============================================================
      if (!Number.isFinite(parsedRadius)) {
        return res.status(400).json({
          success: false,
          message: 'Radius must be a valid number',
        });
      }

      if (parsedRadius <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Radius must be greater than 0',
        });
      }

      if (parsedRadius > 500) {
        return res.status(400).json({
          success: false,
          message: 'Radius cannot be greater than 500',
        });
      }

      // ============================================================
      // VALIDATE COORDINATES
      // ============================================================
      if (!Number.isFinite(parsedLatitude)) {
        return res.status(400).json({
          success: false,
          message: 'Latitude must be a valid number',
        });
      }

      if (parsedLatitude < -90 || parsedLatitude > 90) {
        return res.status(400).json({
          success: false,
          message: 'Latitude must be between -90 and 90',
        });
      }

      if (!Number.isFinite(parsedLongitude)) {
        return res.status(400).json({
          success: false,
          message: 'Longitude must be a valid number',
        });
      }

      if (parsedLongitude < -180 || parsedLongitude > 180) {
        return res.status(400).json({
          success: false,
          message: 'Longitude must be between -180 and 180',
        });
      }

      // ============================================================
      // LOCATION GEOJSON
      // Longitude MUST be index 0, Latitude MUST be index 1
      // ============================================================
      const location = {
        type: 'Point',
        coordinates: [
          parsedLongitude,
          parsedLatitude,
        ],
      };

      // Add locationName if provided
      if (locationName && String(locationName).trim() !== '') {
        location.name = String(locationName).trim();
      }

      // ============================================================
      // ADDRESS
      // ============================================================
      const normalizedAddress =
        address !== undefined && address !== null
          ? String(address).trim()
          : '';

      // ============================================================
      // FIND EXISTING PROFILE
      // ============================================================
      let profile = await ProviderProfile.findOne({
        user: userId,
      });

      // ============================================================
      // UPDATE EXISTING PROFILE
      // ============================================================
      if (profile) {
        profile.services = services;
        profile.radius = parsedRadius;
        profile.location = location;
        profile.address = normalizedAddress;

        await profile.save();

        // MIRROR LOCATION TO USER MODEL FOR LOGIN API
        await User.findByIdAndUpdate(userId, { location: location });

        const populated = await ProviderProfile.findById(profile._id)
          .populate('services', 'name image isActive')
          .populate('user', 'firstName lastName email mobile');

        return res.status(200).json({
          success: true,
          message: 'Work details updated successfully',
          data: populated,
        });
      }

      // ============================================================
      // CREATE NEW PROFILE
      // ============================================================
      profile = await ProviderProfile.create({
        user: userId,
        services,
        radius: parsedRadius,
        location,
        address: normalizedAddress,
      });

      // MIRROR LOCATION TO USER MODEL FOR LOGIN API
      await User.findByIdAndUpdate(userId, { location: location });

      // ============================================================
      // POPULATE RESPONSE
      // ============================================================
      const populated = await ProviderProfile.findById(profile._id)
        .populate('services', 'name image isActive')
        .populate('user', 'firstName lastName email mobile');

      return res.status(201).json({
        success: true,
        message: 'Work details saved successfully',
        data: populated,
      });

    } catch (error) {
      console.error('Add Work Details Error:', error);

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid service ID or user ID',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },


  // ============================================================
  // UPDATE PROVIDER WORK DETAILS
  // ============================================================
  updateWorkDetails: async (req, res) => {
    try {
      const userId = req.user.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      }

      let {
        services,
        radius,
        latitude,
        longitude,
        address,
        locationName, // Added locationName extraction
      } = req.body;

      // ============================================================
      // FIND PROFILE
      // ============================================================
      const profile = await ProviderProfile.findOne({
        user: userId,
      });

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: 'Work details not found. Please add your work details first.',
        });
      }

      // ============================================================
      // SERVICES
      // ============================================================
      if (services !== undefined) {
        if (typeof services === 'string') {
          try {
            services = JSON.parse(services);
          } catch (error) {
            services = services
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean);
          }
        }

        if (!Array.isArray(services)) {
          services = [services];
        }

        services = [
          ...new Set(
            services
              .map((id) => String(id).trim())
              .filter(Boolean)
          ),
        ];

        if (!services.length) {
          return res.status(400).json({
            success: false,
            message: 'Please select at least one service',
          });
        }

        const validServices = await Service.find({
          _id: { $in: services },
          isActive: true,
        }).select('_id');

        if (validServices.length !== services.length) {
          return res.status(400).json({
            success: false,
            message: 'One or more services are invalid or inactive',
          });
        }

        profile.services = services;
      }

      // ============================================================
      // RADIUS
      // ============================================================
      if (radius !== undefined && radius !== null && radius !== '') {
        const parsedRadius = Number(radius);

        if (!Number.isFinite(parsedRadius)) {
          return res.status(400).json({
            success: false,
            message: 'Radius must be a valid number',
          });
        }

        if (parsedRadius <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Radius must be greater than 0',
          });
        }

        if (parsedRadius > 500) {
          return res.status(400).json({
            success: false,
            message: 'Radius cannot be greater than 500',
          });
        }

        profile.radius = parsedRadius;
      }

      // ============================================================
      // LOCATION
      // ============================================================
      const hasLatitude = latitude !== undefined && latitude !== null && latitude !== '';
      const hasLongitude = longitude !== undefined && longitude !== null && longitude !== '';
      const hasLocationName = locationName !== undefined && locationName !== null && String(locationName).trim() !== '';

      // Trigger update if ANY location data is sent
      if (hasLatitude || hasLongitude || hasLocationName) {
        
        let currentLongitude = profile.location?.coordinates?.[0];
        let currentLatitude = profile.location?.coordinates?.[1];
        let currentName = profile.location?.name;

        if (hasLatitude) currentLatitude = Number(latitude);
        if (hasLongitude) currentLongitude = Number(longitude);
        if (hasLocationName) currentName = String(locationName).trim();

        if (
          currentLatitude === undefined ||
          currentLatitude === null ||
          currentLongitude === undefined ||
          currentLongitude === null
        ) {
          return res.status(400).json({
            success: false,
            message: 'Both latitude and longitude are required for a valid location',
          });
        }

        if (!Number.isFinite(currentLatitude) || !Number.isFinite(currentLongitude)) {
          return res.status(400).json({
            success: false,
            message: 'Latitude and longitude must be valid numbers',
          });
        }

        if (currentLatitude < -90 || currentLatitude > 90) {
          return res.status(400).json({
            success: false,
            message: 'Latitude must be between -90 and 90',
          });
        }

        if (currentLongitude < -180 || currentLongitude > 180) {
          return res.status(400).json({
            success: false,
            message: 'Longitude must be between -180 and 180',
          });
        }

        // Build new location object
        profile.location = {
          type: 'Point',
          coordinates: [currentLongitude, currentLatitude],
        };

        // Re-attach the name if it exists
        if (currentName) {
          profile.location.name = currentName;
        }

        // MIRROR LOCATION TO USER MODEL FOR LOGIN API
        await User.findByIdAndUpdate(userId, { location: profile.location });
      }

      // ============================================================
      // ADDRESS
      // ============================================================
      if (address !== undefined) {
        profile.address = String(address).trim();
      }

      // ============================================================
      // SAVE
      // ============================================================
      await profile.save();

      // ============================================================
      // POPULATE
      // ============================================================
      const populated = await ProviderProfile.findById(profile._id)
        .populate('services', 'name image isActive')
        .populate('user', 'firstName lastName email mobile');

      return res.status(200).json({
        success: true,
        message: 'Work details updated successfully',
        data: populated,
      });

    } catch (error) {
      console.error('Update Work Details Error:', error);

      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message: 'Invalid service ID or data',
        });
      }

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },


  // ============================================================
  // GET MY WORK DETAILS
  // ============================================================
  getMyWorkDetails: async (req, res) => {
    try {
      const profile = await ProviderProfile.findOne({
        user: req.user.id,
      })
        .populate('services', 'name image isActive')
        .populate('user', 'firstName lastName email mobile');

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: 'Work details not found. Please add your services first.',
        });
      }

      return res.status(200).json({
        success: true,
        data: profile,
      });

    } catch (error) {
      console.error('Get My Work Details Error:', error);

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },
};