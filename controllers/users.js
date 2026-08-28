const ProviderProfile = require('../models/ProviderProfile');
const Booking = require('../models/Booking');           // NAYA IMPORT
const BookingOffer = require('../models/BookingOffer'); // NAYA IMPORT

module.exports = {

  // ============================================================
  // GET UNIQUE SERVICES FROM NEARBY PROVIDERS & USER OFFERS
  // ============================================================
  home: async (req, res) => {
    try {
      const {
        latitude,
        longitude,
      } = req.query;
      
      // ============================================================
      // VALIDATE LATITUDE
      // ============================================================
      const radius = process.env.NEARBY_RADIUS_KM;
      if (
        latitude === undefined ||
        latitude === null ||
        latitude === ''
      ) {
        return res.status(400).json({
          success: false,
          message: 'Latitude is required',
        });
      }

      // ============================================================
      // VALIDATE LONGITUDE
      // ============================================================
      if (
        longitude === undefined ||
        longitude === null ||
        longitude === ''
      ) {
        return res.status(400).json({
          success: false,
          message: 'Longitude is required',
        });
      }

      const parsedLatitude = Number(latitude);
      const parsedLongitude = Number(longitude);
      const parsedRadius = Number(radius);

      // ============================================================
      // NUMBER VALIDATION
      // ============================================================
      if (!Number.isFinite(parsedLatitude)) {
        return res.status(400).json({
          success: false,
          message: 'Latitude must be a valid number',
        });
      }

      if (!Number.isFinite(parsedLongitude)) {
        return res.status(400).json({
          success: false,
          message: 'Longitude must be a valid number',
        });
      }

      if (!Number.isFinite(parsedRadius)) {
        return res.status(400).json({
          success: false,
          message: 'Radius must be a valid number',
        });
      }

      // ============================================================
      // LATITUDE RANGE
      // ============================================================
      if (
        parsedLatitude < -90 ||
        parsedLatitude > 90
      ) {
        return res.status(400).json({
          success: false,
          message: 'Latitude must be between -90 and 90',
        });
      }

      // ============================================================
      // LONGITUDE RANGE
      // ============================================================
      if (
        parsedLongitude < -180 ||
        parsedLongitude > 180
      ) {
        return res.status(400).json({
          success: false,
          message: 'Longitude must be between -180 and 180',
        });
      }

      // ============================================================
      // RADIUS VALIDATION
      // ============================================================
      if (parsedRadius <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Radius must be greater than 0',
        });
      }

      if (parsedRadius > 500) {
        return res.status(400).json({
          success: false,
          message: 'Radius cannot be greater than 500 KM',
        });
      }

      // ============================================================
      // FIND NEARBY PROVIDERS
      // ============================================================
      //
      // MongoDB $nearSphere distance is in meters.
      //
      const maxDistanceInMeters =
        parsedRadius * 1000;

      const providers =
        await ProviderProfile.find({
          location: {
            $near: {
              $geometry: {
                type: 'Point',
                coordinates: [
                  parsedLongitude,
                  parsedLatitude,
                ],
              },
              $maxDistance:
                maxDistanceInMeters,
            },
          },
        })
          .populate({
            path: 'services',
            select: '_id name image isActive',
            match: {
              isActive: true,
            },
          })
          .select('services');

      // ============================================================
      // UNIQUE SERVICES
      // ============================================================
      const uniqueServices = new Map();

      providers.forEach((provider) => {
        if (
          !provider.services ||
          !Array.isArray(provider.services)
        ) {
          return;
        }

        provider.services.forEach((service) => {
          if (
            !service ||
            !service._id
          ) {
            return;
          }

          const serviceId =
            service._id.toString();

          if (
            !uniqueServices.has(
              serviceId
            )
          ) {
            uniqueServices.set(
              serviceId,
              {
                _id: service._id,
                name: service.name,
                image: service.image || null,
              }
            );
          }
        });
      });

      // ============================================================
      // CONVERT MAP TO ARRAY
      // ============================================================
      const services = Array.from(uniqueServices.values());

      // ============================================================
      // FETCH NEW & ACCEPTED OFFERS FOR THIS USER (SAFE CHECK ADDED)
      // ============================================================
      let newOffers = [];
      let acceptedOffers = [];

      // Check if user is logged in (req.user exists)
      if (req.user && req.user.id) {
          const userId = req.user.id;
          
          // Active bookings of the user
          const userBookings = await Booking.find({ 
              user: userId, 
              deletedAt: null 
          }).distinct('_id');

          // 1. New Offers (Status: 0), Limit: 5
          newOffers = await BookingOffer.find({
              booking: { $in: userBookings },
              status: 0 
          })
          .populate({
              path: 'booking',
              select: 'service description status address',
              populate: { path: 'service', select: 'name image' }
          })
          .populate('provider', 'firstName lastName profileImage')
          .sort({ createdAt: -1 })
          .limit(5)
          .lean();

          // 2. Accepted Offers (Status: 1), Limit: 5
          acceptedOffers = await BookingOffer.find({
              booking: { $in: userBookings },
              status: 1 
          })
          .populate({
              path: 'booking',
              select: 'service description status address',
              populate: { path: 'service', select: 'name image' }
          })
          .populate('provider', 'firstName lastName profileImage')
          .sort({ createdAt: -1 })
          .limit(5)
          .lean();
      }

      // ============================================================
      // RESPONSE
      // ============================================================
      return res.status(200).json({
        success: true,
        message: 'Home data fetched successfully',
        radiusInKm: parsedRadius,
        count: services.length,
        data: services,               // Purana array as it is
        newOffers: newOffers,         // Agar login nahi hai toh empty [] jayega
        acceptedOffers: acceptedOffers // Agar login nahi hai toh empty [] jayega
      });

    } catch (error) {
      console.error(
        'Get User Home Error:',
        error
      );

      // MongoDB GeoJSON / index error
      if (
        error.name ===
        'MongoServerError'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Unable to find nearby services',
          error:
            error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message:
          'Something went wrong',
        error:
          error.message,
      });
    }
  },

  // NOTE: Agar aapke is file mein baaki functions they (jaise notifications wagera),
  // toh is block ke neeche wo add kar lena. Maine aapka bheja hua block poora complete kar diya hai.
};