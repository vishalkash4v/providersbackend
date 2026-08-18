const ProviderProfile = require('../models/ProviderProfile');
const Service = require('../models/Service');
const { validate } = require('../utils/fieldValidations');

module.exports = {

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
      } = req.body;

      // ============================================================
      // PARSE SERVICES
      // ============================================================
      // JSON request:
      // ["id1", "id2"]
      //
      // multipart/form-data:
      // '["id1", "id2"]'
      //
      // Also supports:
      // services=id1
      // services=id2
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

      // ============================================================
      // VALIDATE SERVICE IDs
      // ============================================================

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

      // Optional maximum radius
      if (parsedRadius > 500) {
        return res.status(400).json({
          success: false,
          message: 'Radius cannot be greater than 500',
        });
      }

      // ============================================================
      // VALIDATE LATITUDE
      // ============================================================

      if (!Number.isFinite(parsedLatitude)) {
        return res.status(400).json({
          success: false,
          message: 'Latitude must be a valid number',
        });
      }

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
      // VALIDATE LONGITUDE
      // ============================================================

      if (!Number.isFinite(parsedLongitude)) {
        return res.status(400).json({
          success: false,
          message: 'Longitude must be a valid number',
        });
      }

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
      // LOCATION
      // GeoJSON format:
      // [longitude, latitude]
      // ============================================================

      const location = {
        type: 'Point',
        coordinates: [
          parsedLongitude,
          parsedLatitude,
        ],
      };

      // ============================================================
      // ADDRESS
      // ============================================================

      const normalizedAddress =
        address !== undefined &&
        address !== null
          ? String(address).trim()
          : '';

      // ============================================================
      // FIND EXISTING PROFILE
      // ============================================================

      let profile =
        await ProviderProfile.findOne({
          user: userId,
        });

      // ============================================================
      // UPDATE EXISTING PROFILE
      // ============================================================

      if (profile) {
        profile.services = services;
        profile.radius = parsedRadius;
        profile.location = location;

        // Update address even if user wants to clear it
        profile.address = normalizedAddress;

        await profile.save();

        const populated =
          await ProviderProfile.findById(
            profile._id
          )
            .populate(
              'services',
              'name image isActive'
            )
            .populate(
              'user',
              'firstName lastName email mobile'
            );

        return res.status(200).json({
          success: true,
          message:
            'Work details updated successfully',
          data: populated,
        });
      }

      // ============================================================
      // CREATE NEW PROFILE
      // ============================================================

      profile =
        await ProviderProfile.create({
          user: userId,
          services,
          radius: parsedRadius,
          location,
          address: normalizedAddress,
        });

      // ============================================================
      // POPULATE RESPONSE
      // ============================================================

      const populated =
        await ProviderProfile.findById(
          profile._id
        )
          .populate(
            'services',
            'name image isActive'
          )
          .populate(
            'user',
            'firstName lastName email mobile'
          );

      return res.status(201).json({
        success: true,
        message:
          'Work details saved successfully',
        data: populated,
      });

    } catch (error) {
      console.error(
        'Add Work Details Error:',
        error
      );

      // MongoDB invalid ObjectId
      if (error.name === 'CastError') {
        return res.status(400).json({
          success: false,
          message:
            'Invalid service ID or user ID',
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
      } = req.body;

      // ============================================================
      // FIND PROFILE
      // ============================================================

      const profile =
        await ProviderProfile.findOne({
          user: userId,
        });

      if (!profile) {
        return res.status(404).json({
          success: false,
          message:
            'Work details not found. Please add your work details first.',
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
              .map((id) =>
                String(id).trim()
              )
              .filter(Boolean)
          ),
        ];

        if (!services.length) {
          return res.status(400).json({
            success: false,
            message:
              'Please select at least one service',
          });
        }

        const validServices =
          await Service.find({
            _id: {
              $in: services,
            },
            isActive: true,
          }).select('_id');

        if (
          validServices.length !==
          services.length
        ) {
          return res.status(400).json({
            success: false,
            message:
              'One or more services are invalid or inactive',
          });
        }

        profile.services =
          services;
      }

      // ============================================================
      // RADIUS
      // ============================================================

      if (
        radius !== undefined &&
        radius !== null &&
        radius !== ''
      ) {
        const parsedRadius =
          Number(radius);

        if (
          !Number.isFinite(
            parsedRadius
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Radius must be a valid number',
          });
        }

        if (parsedRadius <= 0) {
          return res.status(400).json({
            success: false,
            message:
              'Radius must be greater than 0',
          });
        }

        if (parsedRadius > 500) {
          return res.status(400).json({
            success: false,
            message:
              'Radius cannot be greater than 500',
          });
        }

        profile.radius =
          parsedRadius;
      }

      // ============================================================
      // LOCATION
      // ============================================================

      const hasLatitude =
        latitude !== undefined &&
        latitude !== null &&
        latitude !== '';

      const hasLongitude =
        longitude !== undefined &&
        longitude !== null &&
        longitude !== '';

      if (
        hasLatitude ||
        hasLongitude
      ) {
        // Existing coordinates
        let currentLongitude =
          profile.location
            ?.coordinates?.[0];

        let currentLatitude =
          profile.location
            ?.coordinates?.[1];

        if (hasLatitude) {
          currentLatitude =
            Number(latitude);
        }

        if (hasLongitude) {
          currentLongitude =
            Number(longitude);
        }

        // Both coordinates must exist
        if (
          currentLatitude ===
            undefined ||
          currentLatitude ===
            null ||
          currentLongitude ===
            undefined ||
          currentLongitude ===
            null
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Both latitude and longitude are required when updating location',
          });
        }

        if (
          !Number.isFinite(
            currentLatitude
          ) ||
          !Number.isFinite(
            currentLongitude
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Latitude and longitude must be valid numbers',
          });
        }

        if (
          currentLatitude < -90 ||
          currentLatitude > 90
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Latitude must be between -90 and 90',
          });
        }

        if (
          currentLongitude < -180 ||
          currentLongitude > 180
        ) {
          return res.status(400).json({
          success: false,
          message:
            'Longitude must be between -180 and 180',
        });
        }

        profile.location = {
          type: 'Point',
          coordinates: [
            currentLongitude,
            currentLatitude,
          ],
        };
      }

      // ============================================================
      // ADDRESS
      // ============================================================

      if (address !== undefined) {
        profile.address =
          String(address).trim();
      }

      // ============================================================
      // SAVE
      // ============================================================

      await profile.save();

      // ============================================================
      // POPULATE
      // ============================================================

      const populated =
        await ProviderProfile.findById(
          profile._id
        )
          .populate(
            'services',
            'name image isActive'
          )
          .populate(
            'user',
            'firstName lastName email mobile'
          );

      return res.status(200).json({
        success: true,
        message:
          'Work details updated successfully',
        data: populated,
      });

    } catch (error) {
      console.error(
        'Update Work Details Error:',
        error
      );

      if (
        error.name ===
        'CastError'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid service ID or data',
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


  // ============================================================
  // GET MY WORK DETAILS
  // ============================================================
  getMyWorkDetails: async (req, res) => {
    try {
      const profile =
        await ProviderProfile.findOne({
          user: req.user.id,
        })
          .populate(
            'services',
            'name image isActive'
          )
          .populate(
            'user',
            'firstName lastName email mobile'
          );

      if (!profile) {
        return res.status(404).json({
          success: false,
          message:
            'Work details not found. Please add your services first.',
        });
      }

      return res.status(200).json({
        success: true,
        data: profile,
      });

    } catch (error) {
      console.error(
        'Get My Work Details Error:',
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