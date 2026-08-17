const ProviderProfile = require('../models/ProviderProfile');
const Service = require('../models/Service');
const { validate } = require('../utils/fieldValidations');

module.exports = {

  // Add / Update Provider Work Details
  addWorkDetails: async (req, res) => {
    try {
      const required = ['services', 'radius', 'latitude', 'longitude'];
      if (validate(req, res, required)) return;

      const { services, radius, latitude, longitude, address } = req.body;
      const userId = req.user.id;

      // services should be array of service IDs
      if (!Array.isArray(services) || services.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Please select at least one service',
        });
      }

      // Validate service IDs
      const validServices = await Service.find({
        _id: { $in: services },
        isActive: true,
      });

      if (validServices.length !== services.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more services are invalid',
        });
      }

      const location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
      };

      let profile = await ProviderProfile.findOne({ user: userId });

      if (profile) {
        // Update existing
        profile.services = services;
        profile.radius = radius;
        profile.location = location;
        if (address) profile.address = address;
        await profile.save();
      } else {
        // Create new
        profile = await ProviderProfile.create({
          user: userId,
          services,
          radius,
          location,
          address: address || '',
        });
      }

      const populated = await ProviderProfile.findById(profile._id)
        .populate('services', 'name image')
        .populate('user', 'firstName lastName email mobile');

      res.status(200).json({
        success: true,
        message: 'Work details saved successfully',
        data: populated,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // Get My Work Details
  getMyWorkDetails: async (req, res) => {
    try {
      const profile = await ProviderProfile.findOne({ user: req.user.id })
        .populate('services', 'name image isActive')
        .populate('user', 'firstName lastName email mobile');

      if (!profile) {
        return res.status(404).json({
          success: false,
          message: 'Work details not found. Please add your services first.',
        });
      }

      res.status(200).json({
        success: true,
        data: profile,
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