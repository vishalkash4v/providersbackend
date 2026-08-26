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
    // PROVIDER DASHBOARD HOME API
    // ============================================================
    getProviderHome: async (req, res) => {
        try {
            const userId = req.user.id;
            
            // Only providers can access this
            if (Number(req.user.role) !== 1) {
                return res.status(403).json({ success: false, message: 'Only providers can access this dashboard' });
            }

            // 👇 1. AUTO-EXPIRE OFFERS (TIMEOUT LOGIC) 👇
            await BookingOffer.updateMany({
                status: 1, 
                providerApprovalExpiresAt: { $lt: new Date() } 
            }, {
                $set: { status: 5 } 
            });

            // ========================================================
            // FETCH PROVIDER DETAILS & STATS
            // ========================================================
            const providerProfileData = await ProviderProfile.findOne({ user: userId }).lean();
            const mySelectedServices = providerProfileData?.services || [];

            const providerUser = await User.findById(userId).select('bookingCredits').lean();
            const creditsLeft = Math.max(0, Number(providerUser?.bookingCredits || 0));

            const pendingReferrals = await Referral.countDocuments({ referrer: userId, status: 'PENDING' });
            
            const providerOffers = await BookingOffer.find({ provider: userId }).lean();

            // ========================================================
            // BUILD QUERIES
            // ========================================================
            const baseQuery = { deletedAt: null, isActive: true, status: 0 };

            // -- For New Jobs (Type 0) --
            const myActiveOfferBookingIds = providerOffers
                .filter(o => [0, 1, 3].includes(o.status))
                .map(o => o.booking.toString());

            let newJobsQuery = { ...baseQuery, notifiedProviders: userId };
            if (mySelectedServices.length > 0) newJobsQuery.service = { $in: mySelectedServices };
            if (myActiveOfferBookingIds.length > 0) newJobsQuery._id = { $nin: myActiveOfferBookingIds };

            // -- For Accepted Offers (Type 1) --
            const activePendingBookingIds = providerOffers
                .filter(o => o.status === 1) // Only accepted by user waiting for provider payment
                .map(o => o.booking.toString());
            
            let acceptedOffersQuery = { ...baseQuery, _id: { $in: activePendingBookingIds } };

            // ========================================================
            // FETCH BOTH ARRAYS IN PARALLEL (For Max Speed)
            // ========================================================
            let [newJobs, acceptedOffers] = await Promise.all([
                Booking.find(newJobsQuery)
                    .populate('service', 'name image')
                    .populate('user', 'firstName lastName mobile email profileImage')
                    .sort({ createdAt: -1 }).lean(),
                Booking.find(acceptedOffersQuery)
                    .populate('service', 'name image')
                    .populate('user', 'firstName lastName mobile email profileImage')
                    .sort({ createdAt: -1 }).lean()
            ]);

            // ========================================================
            // INJECT DATA HELPER FUNCTION
            // ========================================================
            const injectOfferData = (booking, typeFlag) => {
                let distanceKm = null;
                if (providerProfileData?.location?.coordinates && booking.location?.coordinates) {
                    const [pLng, pLat] = providerProfileData.location.coordinates;
                    const [bLng, bLat] = booking.location.coordinates;
                    distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
                }
                booking.distanceKm = distanceKm;

                const myOffer = providerOffers.find(o => o.booking.toString() === booking._id.toString());

                booking.offerId = myOffer ? myOffer._id : null;
                booking.providerApprovalExpiresAt = (myOffer && myOffer.status === 1) ? myOffer.providerApprovalExpiresAt : null;
                booking.creditsLeft = creditsLeft;
                
                booking.offerAmount = myOffer ? myOffer.offerAmount : null;
                booking.proposedDate = myOffer ? myOffer.proposedDate : null;
                booking.proposedTime = myOffer ? myOffer.proposedTime : null;
                booking.accessFee = myOffer ? myOffer.accessFee : null;
                booking.offerStatus = myOffer ? myOffer.status : null; 

                if (typeFlag === '0') {
                    booking.newStatus = (myOffer && [2, 4, 5].includes(myOffer.status)) ? 1 : 0;
                } else {
                    booking.newStatus = (myOffer && myOffer.status === 1) ? 1 : 0;
                }

                return booking;
            };

            // Apply injection
            newJobs = newJobs.map(job => injectOfferData(job, '0'));
            acceptedOffers = acceptedOffers.map(job => injectOfferData(job, '1'));

            // ========================================================
            // FINAL RESPONSE
            // ========================================================
            return res.status(200).json({
                success: true,
                message: 'Provider home dashboard fetched successfully',
                data: {
                    stats: {
                        creditsLeft: creditsLeft,
                        pendingReferrals: pendingReferrals,
                        newJobsCount: newJobs.length,
                        actionRequiredCount: acceptedOffers.length
                    },
                    newJobs: newJobs,
                    acceptedOffers: acceptedOffers
                }
            });

        } catch (error) {
            console.error('Get Provider Home Error:', error);
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

      console.log("all data of body",req.body);

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

      console.log("all data of body",req.body);


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


// ============================================================
// GET REFERRAL STATS & LIST
// ============================================================
getReferrals: async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get exact counts directly from DB
        const pendingCount = await Referral.countDocuments({ referrer: userId, status: 'PENDING' });
        const successCount = await Referral.countDocuments({ referrer: userId, status: 'SUCCESS' });
        
        // 2. Calculate total rewards earned so far
        const successReferrals = await Referral.find({ referrer: userId, status: 'SUCCESS' }).lean();
        const totalCreditsEarned = successReferrals.reduce((sum, ref) => sum + (Number(ref.rewardCredits) || 0), 0);

        // 3. Get detailed list of all referred users with their basic profile info
        const referralsList = await Referral.find({ referrer: userId })
            .populate('referredProvider', 'firstName lastName profileImage createdAt') // Get details of joined user
            .sort({ createdAt: -1 })
            .lean();

        return res.status(200).json({
            success: true,
            message: 'Referral stats fetched successfully',
            data: {
                stats: {
                    totalReferrals: pendingCount + successCount,
                    pending: pendingCount,
                    success: successCount,
                    totalCreditsEarned: totalCreditsEarned
                },
                list: referralsList
            }
        });
    } catch (error) {
        console.error('Get Referrals Error:', error);
        return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
}
};