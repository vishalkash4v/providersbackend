const ProviderProfile = require('../models/ProviderProfile');

module.exports = {

  // ============================================================
  // GET UNIQUE SERVICES FROM NEARBY PROVIDERS
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
      //
      // Map prevents duplicate services.
      //
      // Example:
      //
      // Provider 1 -> Plumber
      // Provider 2 -> Plumber
      // Provider 3 -> Electrician
      //
      // Result:
      //
      // Plumber
      // Electrician
      //
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
      const services =
        Array.from(
          uniqueServices.values()
        );

      // ============================================================
      // RESPONSE
      // ============================================================
      return res.status(200).json({
        success: true,
        message:
          'Nearby services fetched successfully',
        radiusInKm: parsedRadius,
        count: services.length,
        data: services,
      });

    } catch (error) {
      console.error(
        'Get Nearby Services Error:',
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




};