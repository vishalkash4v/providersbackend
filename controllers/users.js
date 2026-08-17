const ProviderProfile = require('../models/ProviderProfile');

module.exports = {

  // Homepage - Get Nearby Providers
  getNearbyProviders: async (req, res) => {
    try {
      const { latitude, longitude, serviceId } = req.query;

      if (!latitude || !longitude) {
        return res.status(400).json({
          success: false,
          message: 'latitude and longitude are required',
        });
      }

      const maxDistance = process.env.NEARBY_RADIUS_KM
        ? Number(process.env.NEARBY_RADIUS_KM) * 1000 // convert km to meters
        : 10000; // default 10km

      const query = {
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [parseFloat(longitude), parseFloat(latitude)],
            },
            $maxDistance: maxDistance,
          },
        },
      };

      // Optional: filter by service
      if (serviceId) {
        query.services = serviceId;
      }

      const providers = await ProviderProfile.find(query)
        .populate('user', 'firstName lastName email mobile profileImage')
        .populate('services', 'name image')
        .limit(50);

      res.status(200).json({
        success: true,
        message: 'Nearby providers fetched successfully',
        radiusInKm: process.env.NEARBY_RADIUS_KM || 10,
        count: providers.length,
        data: providers,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },
};