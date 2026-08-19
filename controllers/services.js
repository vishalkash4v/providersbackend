const Service = require('../models/Service');
const { validate } = require('../utils/fieldValidations');
const { uploadSingleFile } = require('../utils/r2uploads');

module.exports = {

  // ============================================================
  // ADD SERVICE CATEGORY
  // ============================================================

  addService: async (req, res) => {
    try {
      const required = ['name'];

      if (validate(req, res, required)) return;

      const { name } = req.body;

      let image = null;

      // ========================================================
      // UPLOAD IMAGE TO R2
      // ========================================================

      if (req.files && req.files.image) {
        const uploaded = await uploadSingleFile(
          req,
          'image',
          'services'
        );

        if (uploaded) {
          image = uploaded.path;
        }

        console.log('R2 Uploaded file info:', uploaded);
      }

      // ========================================================
      // CHECK DUPLICATE SERVICE
      // ========================================================

      const exists = await Service.findOne({
        name: name.trim(),
      });

      if (exists) {
        return res.status(400).json({
          success: false,
          message: 'Service already exists',
        });
      }

      // ========================================================
      // CREATE SERVICE
      // ========================================================

      const service = await Service.create({
        name: name.trim(),
        image,
        addedBy: req.user.id,
      });

      return res.status(201).json({
        success: true,
        message: 'Service added successfully',
        data: service,
      });

    } catch (error) {
      console.error('Add Service Error:', error);

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // ============================================================
  // GET ALL SERVICES
  // ============================================================

  getAllServices: async (req, res) => {
    try {
      const services = await Service.find()
        .populate(
          'addedBy',
          'firstName lastName email'
        )
        .sort({
          createdAt: -1,
        });

      return res.status(200).json({
        success: true,
        data: services,
      });

    } catch (error) {
      console.error('Get All Services Error:', error);

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // ============================================================
  // GET ACTIVE SERVICES
  // ============================================================

  getActiveServices: async (req, res) => {
    try {
      const services = await Service.find({
        isActive: true,
      }).sort({
        name: 1,
      });

      return res.status(200).json({
        success: true,
        data: services,
      });

    } catch (error) {
      console.error('Get Active Services Error:', error);

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // ============================================================
  // UPDATE SERVICE
  // ============================================================

  updateService: async (req, res) => {
    try {
      const { id } = req.params;
      const { name, isActive } = req.body;

      // ========================================================
      // FIND SERVICE
      // ========================================================

      const service = await Service.findById(id);

      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      // ========================================================
      // NAME UPDATE
      // ========================================================

      if (name !== undefined) {
        const trimmedName = name.trim();

        if (!trimmedName) {
          return res.status(400).json({
            success: false,
            message: 'Service name is required',
          });
        }

        // Check duplicate name excluding current service
        const existingService =
          await Service.findOne({
            name: trimmedName,
            _id: {
              $ne: id,
            },
          });

        if (existingService) {
          return res.status(400).json({
            success: false,
            message:
              'Service with this name already exists! choose another name',
          });
        }

        service.name = trimmedName;
      }

      // ========================================================
      // ACTIVE STATUS
      // ========================================================

      if (typeof isActive !== 'undefined') {
        service.isActive =
          isActive === true ||
          isActive === 'true' ||
          isActive === 1 ||
          isActive === '1';
      }

      // ========================================================
      // IMAGE UPDATE → R2
      // ========================================================

      if (req.files && req.files.image) {
        const uploaded =
          await uploadSingleFile(
            req,
            'image',
            'services'
          );

        if (uploaded) {
          service.image = uploaded.path;
        }
      }

      // ========================================================
      // SAVE SERVICE
      // ========================================================

      await service.save();

      // ========================================================
      // RESPONSE
      // ========================================================

      return res.status(200).json({
        success: true,
        message: 'Service updated successfully',
        data: service,
      });

    } catch (error) {
      console.error(
        'Update Service Error:',
        error
      );

      // Handle MongoDB duplicate key
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

  // ============================================================
  // TOGGLE ACTIVE / INACTIVE
  // ============================================================

  toggleServiceStatus: async (req, res) => {
    try {
      const { id } = req.params;

      const service =
        await Service.findById(id);

      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      service.isActive =
        !service.isActive;

      await service.save();

      return res.status(200).json({
        success: true,
        message:
          `Service ${
            service.isActive
              ? 'activated'
              : 'deactivated'
          } successfully`,
        data: service,
      });

    } catch (error) {
      console.error(
        'Toggle Service Status Error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },

  // ============================================================
  // DELETE SERVICE
  // ============================================================

  deleteService: async (req, res) => {
    try {
      const { id } = req.params;

      const service =
        await Service.findByIdAndDelete(id);

      if (!service) {
        return res.status(404).json({
          success: false,
          message: 'Service not found',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Service deleted successfully',
      });

    } catch (error) {
      console.error(
        'Delete Service Error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Something went wrong',
        error: error.message,
      });
    }
  },
};