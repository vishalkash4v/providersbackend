const Service = require('../models/Service');
const { validate } = require('../utils/fieldValidations');
const { uploadSingleFile } = require('../utils/expressfileupload'); // or your file name

module.exports = {

  // Add Service Category
  addService: async (req, res) => {
    try {
      const required = ['name'];
      if (validate(req, res, required)) return;

      const { name } = req.body;
      let image = req.files?.image ? req.files.image.name : null; // handle properly later

  
      
          if (req.files && req.files.image) {
            const uploaded = await uploadSingleFile(req, 'image', 'uploads/services');
            if (uploaded) {
              image = uploaded.path; // or uploaded.path depending on what you store
            }
            console.log('Uploaded file info:', uploaded);
          }
      const exists = await Service.findOne({ name: name.trim() });
      if (exists) {
        return res.status(400).json({
          success: false,
          message: 'Service already exists',
        });
      }

      const service = await Service.create({
        name: name.trim(),
        image,
        addedBy: req.user.id,
      });

      res.status(201).json({
        success: true,
        message: 'Service added successfully',
        data: service,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // Get All Services
  getAllServices: async (req, res) => {
    try {
      const services = await Service.find()
        .populate('addedBy', 'firstName lastName email')
        .sort({ createdAt: -1 });

      res.status(200).json({
        success: true,
        data: services,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // Get Active Services only
  getActiveServices: async (req, res) => {
    try {
      const services = await Service.find({ isActive: true }).sort({ name: 1 });

      res.status(200).json({
        success: true,
        data: services,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // Update Service
  // Update Service
updateService: async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isActive } = req.body;

    // ====================== FIND SERVICE ======================
    const service = await Service.findById(id);

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found',
      });
    }

    // ====================== NAME UPDATE ======================
    if (name !== undefined) {
      const trimmedName = name.trim();

      if (!trimmedName) {
        return res.status(400).json({
          success: false,
          message: 'Service name is required',
        });
      }

      // Check duplicate name excluding current service
      const existingService = await Service.findOne({
        name: trimmedName,
        _id: { $ne: id },
      });

      if (existingService) {
        return res.status(400).json({
          success: false,
          message: 'Service with this name already exists! choose another name',
        });
      }

      service.name = trimmedName;
    }

    // ====================== ACTIVE STATUS ======================
    if (typeof isActive !== 'undefined') {
      service.isActive =
        isActive === true ||
        isActive === 'true' ||
        isActive === 1 ||
        isActive === '1';
    }

    // ====================== IMAGE UPDATE ======================
    if (req.files && req.files.image) {
      const uploaded = await uploadSingleFile(
        req,
        'image',
        'uploads/services'
      );

      if (uploaded) {
        service.image = uploaded.path;
      }
    }

    // ====================== SAVE ======================
    await service.save();

    // ====================== RESPONSE ======================
    return res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      data: service,
    });

  } catch (error) {
    console.error('Update Service Error:', error);

    // Handle MongoDB duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Service already exists',
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Something went wrong',
      error: error.message,
    });
  }
},

  // Toggle Active / Inactive
  toggleServiceStatus: async (req, res) => {
    try {
      const { id } = req.params;

      const service = await Service.findById(id);
      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      service.isActive = !service.isActive;
      await service.save();

      res.status(200).json({
        success: true,
        message: `Service ${service.isActive ? 'activated' : 'deactivated'} successfully`,
        data: service,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // Delete Service
  deleteService: async (req, res) => {
    try {
      const { id } = req.params;

      const service = await Service.findByIdAndDelete(id);
      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      res.status(200).json({
        success: true,
        message: 'Service deleted successfully',
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