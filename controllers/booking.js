const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const Service = require('../models/Service');
const ProviderProfile = require('../models/ProviderProfile');

const { validate } = require('../utils/fieldValidations');
const { uploadFiles } = require('../utils/expressfileupload');
const { calculateDistance } = require('../utils/distance');
const { notifyUser } = require('../utils/notification');


// ============================================================
// HELPER: NOTIFY MATCHING PROVIDERS
// ============================================================

const notifyMatchingProviders = async (
  booking,
  isUpdate = false
) => {
  try {
    const service = await Service.findById(
      booking.service
    );

    if (!service) {
      return;
    }

    // Only active pending bookings
    if (
      booking.status !== 'PENDING' ||
      !booking.isActive
    ) {
      return;
    }

    if (
      !booking.location ||
      !Array.isArray(
        booking.location.coordinates
      ) ||
      booking.location.coordinates.length !== 2
    ) {
      return;
    }

    const [
      bookingLng,
      bookingLat,
    ] = booking.location.coordinates;

    // ========================================================
    // FIND PROVIDERS WHO OFFER THIS SERVICE
    // ========================================================

    const providerProfiles =
      await ProviderProfile.find({
        services: booking.service,
        location: {
          $exists: true,
        },
      }).populate(
        'user',
        'firstName lastName email mobile role isActive'
      );

    const currentProviderIds = [];
    const providerDistances = new Map();

    // ========================================================
    // CHECK PROVIDER DISTANCE
    // ========================================================

    for (
      const profile of providerProfiles
    ) {
      if (!profile.user) {
        continue;
      }

      if (!profile.user.isActive) {
        continue;
      }

      // Don't notify customer as provider
      if (
        profile.user._id.toString() ===
        booking.user.toString()
      ) {
        continue;
      }

      if (
        !profile.location ||
        !Array.isArray(
          profile.location.coordinates
        ) ||
        profile.location.coordinates.length !== 2
      ) {
        continue;
      }

      const [
        providerLng,
        providerLat,
      ] = profile.location.coordinates;

      const distance =
        calculateDistance(
          bookingLat,
          bookingLng,
          providerLat,
          providerLng
        );

      const providerRadius =
        Number(profile.radius);

      if (
        !Number.isFinite(
          providerRadius
        ) ||
        providerRadius <= 0
      ) {
        continue;
      }

      // Provider is outside his service radius
      if (
        distance > providerRadius
      ) {
        continue;
      }

      const providerId =
        profile.user._id.toString();

      currentProviderIds.push(
        providerId
      );

      providerDistances.set(
        providerId,
        distance
      );
    }

    // ========================================================
    // OLD PROVIDERS
    // ========================================================

    const oldProviderIds =
      (
        booking.notifiedProviders ||
        []
      ).map((id) =>
        id.toString()
      );

    // ========================================================
    // NEW PROVIDERS
    // ========================================================

    const newProviderIds =
      currentProviderIds.filter(
        (id) =>
          !oldProviderIds.includes(id)
      );

    // ========================================================
    // EXISTING PROVIDERS
    // ========================================================

    const existingProviderIds =
      currentProviderIds.filter(
        (id) =>
          oldProviderIds.includes(id)
      );

    // ========================================================
    // PROVIDERS WHO NO LONGER MATCH
    // ========================================================

    const removedProviderIds =
      oldProviderIds.filter(
        (id) =>
          !currentProviderIds.includes(id)
      );

    // ========================================================
    // NOTIFY NEW PROVIDERS
    // ========================================================

    for (
      const providerId of newProviderIds
    ) {
      const distance =
        providerDistances.get(
          providerId
        );

      try {
        await notifyUser({
          userId: providerId,

          type:
            'NEW_BOOKING_REQUEST',

          title:
            'New Service Request',

          message:
            `Someone is looking for ${service.name} at ${
              booking.address ||
              'the selected location'
            }, approximately ${Number(
              distance
            ).toFixed(1)} km from you.`,

          bookingId:
            booking._id,

          serviceId:
            service._id,

          distanceInKm:
            distance,

          data: {
            bookingId:
              String(booking._id),

            serviceId:
              String(service._id),

            bookingStatus:
              booking.status,

            bookingActive:
              booking.isActive,

            distance:
              String(distance),

            latitude:
              String(bookingLat),

            longitude:
              String(bookingLng),
          },
        });
      } catch (error) {
        console.error(
          `New provider notification error for ${providerId}:`,
          error.message
        );
      }
    }

    // ========================================================
    // NOTIFY EXISTING PROVIDERS ON UPDATE
    // ========================================================

    if (isUpdate) {
      for (
        const providerId of
          existingProviderIds
      ) {
        const distance =
          providerDistances.get(
            providerId
          );

        try {
          await notifyUser({
            userId: providerId,

            type:
              'BOOKING_UPDATED',

            title:
              'Booking Updated',

            message:
              `The ${service.name} service request has been updated. Please check the latest details.`,

            bookingId:
              booking._id,

            serviceId:
              service._id,

            distanceInKm:
              distance,

            data: {
              bookingId:
                String(booking._id),

              serviceId:
                String(service._id),

              bookingStatus:
                booking.status,

              bookingActive:
                booking.isActive,

              distance:
                String(distance),

              latitude:
                String(bookingLat),

              longitude:
                String(bookingLng),
            },
          });
        } catch (error) {
          console.error(
            `Booking update notification error for ${providerId}:`,
            error.message
          );
        }
      }
    }

    // ========================================================
    // PROVIDERS WHO NO LONGER MATCH
    // ========================================================

    if (isUpdate) {
      for (
        const providerId of
          removedProviderIds
      ) {
        try {
          await notifyUser({
            userId: providerId,

            type:
              'BOOKING_UNAVAILABLE',

            title:
              'Booking No Longer Available',

            message:
              `The ${service.name} service request is no longer available for you.`,

            bookingId:
              booking._id,

            serviceId:
              service._id,

            data: {
              bookingId:
                String(booking._id),

              serviceId:
                String(service._id),

              bookingStatus:
                booking.status,

              bookingActive:
                false,
            },
          });
        } catch (error) {
          console.error(
            `Booking unavailable notification error for ${providerId}:`,
            error.message
          );
        }
      }
    }

    // ========================================================
    // SAVE CURRENT PROVIDERS
    // ========================================================

    booking.notifiedProviders =
      currentProviderIds.map(
        (id) =>
          new mongoose.Types.ObjectId(id)
      );

    await booking.save();

  } catch (error) {
    console.error(
      'notifyMatchingProviders Error:',
      error
    );
  }
};


// ============================================================
// HELPER: NOTIFY CURRENT PROVIDERS THAT BOOKING IS UNAVAILABLE
// ============================================================

const notifyExistingProvidersUnavailable =
  async (booking) => {
    try {
      const service =
        await Service.findById(
          booking.service
        );

      if (!service) {
        return;
      }

      const providerIds =
        (
          booking.notifiedProviders ||
          []
        ).map((id) =>
          id.toString()
        );

      for (
        const providerId of providerIds
      ) {
        try {
          await notifyUser({
            userId:
              providerId,

            type:
              'BOOKING_UNAVAILABLE',

            title:
              'Booking No Longer Available',

            message:
              `The ${service.name} service request is no longer available.`,

            bookingId:
              booking._id,

            serviceId:
              service._id,

            data: {
              bookingId:
                String(booking._id),

              serviceId:
                String(service._id),

              bookingStatus:
                booking.status,

              bookingActive:
                false,
            },
          });
        } catch (error) {
          console.error(
            `Booking unavailable notification error for ${providerId}:`,
            error.message
          );
        }
      }

      // Clear providers after notification
      booking.notifiedProviders = [];

      await booking.save();

    } catch (error) {
      console.error(
        'notifyExistingProvidersUnavailable Error:',
        error
      );
    }
  };


// ============================================================
// CONTROLLER
// ============================================================

module.exports = {

  // ============================================================
  // CREATE BOOKING
  // ============================================================

  createBooking: async (req, res) => {
    try {
      const required = [
        'service',
        'latitude',
        'longitude',
      ];

      if (
        validate(
          req,
          res,
          required
        )
      ) {
        return;
      }

      const {
        service: serviceId,
        description,
        materialRequired,
        materialOption,
        latitude,
        longitude,
        address,
        visitPreference,
        preferredDates,
        preferredTimeStart,
        preferredTimeEnd,
      } = req.body;

      const userId =
        req.user.id;

      // ========================================================
      // CUSTOMER ONLY
      // ========================================================

      if (
        Number(req.user.role) !== 0
      ) {
        return res.status(403).json({
          success: false,
          message:
            'Only customers can create bookings',
        });
      }

      // ========================================================
      // SERVICE
      // ========================================================

      const service =
        await Service.findOne({
          _id: serviceId,
          isActive: true,
        });

      if (!service) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid or inactive service',
        });
      }

      // ========================================================
      // LOCATION
      // ========================================================

      const lat =
        Number(latitude);

      const lng =
        Number(longitude);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Latitude and longitude must be valid numbers',
        });
      }

      if (
        lat < -90 ||
        lat > 90
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Latitude must be between -90 and 90',
        });
      }

      if (
        lng < -180 ||
        lng > 180
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Longitude must be between -180 and 180',
        });
      }

      // ========================================================
      // VISIT PREFERENCE
      // ========================================================

      const normalizedVisitPreference =
        visitPreference ||
        'immediate';

      if (
        ![
          'immediate',
          'scheduled',
        ].includes(
          normalizedVisitPreference
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid visit preference. Use immediate or scheduled',
        });
      }

      // ========================================================
      // MATERIAL
      // ========================================================

      const normalizedMaterialRequired =
        materialRequired === true ||
        materialRequired === 'true' ||
        materialRequired === 1 ||
        materialRequired === '1';

      let normalizedMaterialOption =
        materialOption ||
        null;

      if (
        normalizedMaterialOption &&
        ![
          'user_has_material',
          'provider_brings_material',
        ].includes(
          normalizedMaterialOption
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Invalid material option',
        });
      }

      if (
        !normalizedMaterialRequired
      ) {
        normalizedMaterialOption =
          null;
      }

      // ========================================================
      // PREFERRED DATES
      // ========================================================

      let normalizedPreferredDates =
        [];

      if (preferredDates) {
        try {
          if (
            Array.isArray(
              preferredDates
            )
          ) {
            normalizedPreferredDates =
              preferredDates;
          } else if (
            typeof preferredDates ===
            'string'
          ) {
            const value =
              preferredDates.trim();

            if (
              value.startsWith('[')
            ) {
              normalizedPreferredDates =
                JSON.parse(value);
            } else {
              normalizedPreferredDates =
                [value];
            }
          }
        } catch (error) {
          return res.status(400).json({
            success: false,
            message:
              'preferredDates must be a valid array',
          });
        }
      }

      normalizedPreferredDates =
        [
          ...new Set(
            normalizedPreferredDates
              .filter(Boolean)
              .map((date) => {
                const parsed =
                  new Date(date);

                if (
                  Number.isNaN(
                    parsed.getTime()
                  )
                ) {
                  return null;
                }

                return parsed
                  .toISOString()
                  .split('T')[0];
              })
              .filter(Boolean)
          ),
        ].map(
          (date) =>
            new Date(date)
        );

      // ========================================================
      // TIME VALIDATION
      // ========================================================

      const timeRegex =
        /^([01]\d|2[0-3]):([0-5]\d)$/;

      if (
        preferredTimeStart &&
        !timeRegex.test(
          preferredTimeStart.trim()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'preferredTimeStart must be in HH:mm format',
        });
      }

      if (
        preferredTimeEnd &&
        !timeRegex.test(
          preferredTimeEnd.trim()
        )
      ) {
        return res.status(400).json({
          success: false,
          message:
            'preferredTimeEnd must be in HH:mm format',
        });
      }

      // ========================================================
      // WORK IMAGES
      // ========================================================

      let workImages = [];

      if (
        req.files &&
        Object.keys(req.files).length
      ) {
        const uploaded =
          await uploadFiles(
            req,
            'uploads/bookings'
          );

        workImages =
          uploaded.map(
            (file) =>
              `uploads/bookings/${file.fileName}`
          );
      }

      // ========================================================
      // CREATE BOOKING
      // ========================================================

      const booking =
        await Booking.create({
          user: userId,

          service: serviceId,

          provider: null,

          workImages,

          description:
            description
              ? description.trim()
              : '',

          materialRequired:
            normalizedMaterialRequired,

          materialOption:
            normalizedMaterialOption,

          location: {
            type: 'Point',
            coordinates: [
              lng,
              lat,
            ],
          },

          address:
            address
              ? address.trim()
              : '',

          visitPreference:
            normalizedVisitPreference,

          preferredDates:
            normalizedPreferredDates,

          preferredTimeStart:
            preferredTimeStart
              ? preferredTimeStart.trim()
              : null,

          preferredTimeEnd:
            preferredTimeEnd
              ? preferredTimeEnd.trim()
              : null,

          status:
            'PENDING',

          isActive:
            true,

          notifiedProviders:
            [],
        });

      // ========================================================
      // NOTIFY PROVIDERS
      // ========================================================

      await notifyMatchingProviders(
        booking,
        false
      );

      // ========================================================
      // RESPONSE
      // ========================================================

      const populatedBooking =
        await Booking.findById(
          booking._id
        )
          .populate(
            'service',
            'name image'
          )
          .populate(
            'user',
            'firstName lastName email mobile'
          );

      return res.status(201).json({
        success: true,
        message:
          'Booking created successfully',
        data:
          populatedBooking,
      });

    } catch (error) {
      console.error(
        'Create Booking Error:',
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


  // ============================================================
  // UPDATE BOOKING
  // ONLY PENDING + ACTIVE
  // ============================================================

  updateBooking: async (
    req,
    res
  ) => {
    try {
      const { id } =
        req.params;

      const userId =
        req.user.id;

      const booking =
        await Booking.findOne({
          _id: id,
          user: userId,
        });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message:
            'Booking not found',
        });
      }

      // ========================================================
      // ONLY PENDING
      // ========================================================

      if (
        booking.status !==
        'PENDING'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Booking can only be updated while it is pending',
        });
      }

      // ========================================================
      // ONLY ACTIVE
      // ========================================================

      if (
        !booking.isActive
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Inactive booking cannot be updated',
        });
      }

      const {
        service: serviceId,
        description,
        materialRequired,
        materialOption,
        latitude,
        longitude,
        address,
        visitPreference,
        preferredDates,
        preferredTimeStart,
        preferredTimeEnd,
      } = req.body;

      // ========================================================
      // SERVICE
      // ========================================================

      if (serviceId) {
        const service =
          await Service.findOne({
            _id: serviceId,
            isActive: true,
          });

        if (!service) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid or inactive service',
          });
        }

        booking.service =
          serviceId;
      }

      // ========================================================
      // LOCATION
      // ========================================================

      if (
        latitude !== undefined ||
        longitude !== undefined
      ) {
        const existingLat =
          booking.location
            ?.coordinates?.[1];

        const existingLng =
          booking.location
            ?.coordinates?.[0];

        const lat =
          Number(
            latitude !== undefined
              ? latitude
              : existingLat
          );

        const lng =
          Number(
            longitude !== undefined
              ? longitude
              : existingLng
          );

        if (
          !Number.isFinite(lat) ||
          !Number.isFinite(lng)
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Latitude and longitude must be valid numbers',
          });
        }

        if (
          lat < -90 ||
          lat > 90
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Latitude must be between -90 and 90',
          });
        }

        if (
          lng < -180 ||
          lng > 180
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Longitude must be between -180 and 180',
          });
        }

        booking.location = {
          type: 'Point',
          coordinates: [
            lng,
            lat,
          ],
        };
      }

      // ========================================================
      // DESCRIPTION
      // ========================================================

      if (
        description !==
        undefined
      ) {
        booking.description =
          description
            ? description.trim()
            : '';
      }

      // ========================================================
      // ADDRESS
      // ========================================================

      if (
        address !== undefined
      ) {
        booking.address =
          address
            ? address.trim()
            : '';
      }

      // ========================================================
      // MATERIAL REQUIRED
      // ========================================================

      if (
        materialRequired !==
        undefined
      ) {
        const required =
          materialRequired === true ||
          materialRequired === 'true' ||
          materialRequired === 1 ||
          materialRequired === '1';

        booking.materialRequired =
          required;

        if (!required) {
          booking.materialOption =
            null;
        }
      }

      // ========================================================
      // MATERIAL OPTION
      // ========================================================

      if (
        materialOption !==
        undefined
      ) {
        if (
          materialOption !== null &&
          ![
            'user_has_material',
            'provider_brings_material',
          ].includes(
            materialOption
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid material option',
          });
        }

        if (
          booking.materialRequired
        ) {
          booking.materialOption =
            materialOption;
        }
      }

      // ========================================================
      // VISIT PREFERENCE
      // ========================================================

      if (
        visitPreference !==
        undefined
      ) {
        if (
          ![
            'immediate',
            'scheduled',
          ].includes(
            visitPreference
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'Invalid visit preference',
          });
        }

        booking.visitPreference =
          visitPreference;
      }

      // ========================================================
      // PREFERRED DATES
      // ========================================================

      if (
        preferredDates !==
        undefined
      ) {
        let dates =
          preferredDates;

        try {
          if (
            typeof dates ===
            'string'
          ) {
            if (
              dates
                .trim()
                .startsWith('[')
            ) {
              dates =
                JSON.parse(
                  dates
                );
            } else {
              dates = [
                dates,
              ];
            }
          }

          if (
            !Array.isArray(
              dates
            )
          ) {
            throw new Error();
          }

          booking.preferredDates =
            [
              ...new Set(
                dates
                  .filter(Boolean)
                  .map(
                    (date) => {
                      const parsed =
                        new Date(
                          date
                        );

                      if (
                        Number.isNaN(
                          parsed.getTime()
                        )
                      ) {
                        return null;
                      }

                      return parsed
                        .toISOString()
                        .split(
                          'T'
                        )[0];
                    }
                  )
                  .filter(Boolean)
              ),
            ].map(
              (date) =>
                new Date(date)
            );

        } catch (error) {
          return res.status(400).json({
            success: false,
            message:
              'preferredDates must be a valid array',
          });
        }
      }

      // ========================================================
      // TIME REGEX
      // ========================================================

      const timeRegex =
        /^([01]\d|2[0-3]):([0-5]\d)$/;

      // ========================================================
      // PREFERRED TIME START
      // ========================================================

      if (
        preferredTimeStart !==
        undefined
      ) {
        if (
          preferredTimeStart &&
          !timeRegex.test(
            preferredTimeStart.trim()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'preferredTimeStart must be in HH:mm format',
          });
        }

        booking.preferredTimeStart =
          preferredTimeStart
            ? preferredTimeStart.trim()
            : null;
      }

      // ========================================================
      // PREFERRED TIME END
      // ========================================================

      if (
        preferredTimeEnd !==
        undefined
      ) {
        if (
          preferredTimeEnd &&
          !timeRegex.test(
            preferredTimeEnd.trim()
          )
        ) {
          return res.status(400).json({
            success: false,
            message:
              'preferredTimeEnd must be in HH:mm format',
          });
        }

        booking.preferredTimeEnd =
          preferredTimeEnd
            ? preferredTimeEnd.trim()
            : null;
      }

      // ========================================================
      // NEW WORK IMAGES
      // ========================================================

      if (
        req.files &&
        Object.keys(req.files).length
      ) {
        const uploaded =
          await uploadFiles(
            req,
            'uploads/bookings'
          );

        const newImages =
          uploaded.map(
            (file) =>
              `uploads/bookings/${file.fileName}`
          );

        booking.workImages = [
          ...(booking.workImages ||
            []),
          ...newImages,
        ];
      }

      // ========================================================
      // SAVE
      // ========================================================

      await booking.save();

      // ========================================================
      // RE-MATCH PROVIDERS
      // ========================================================

      await notifyMatchingProviders(
        booking,
        true
      );

      // ========================================================
      // RESPONSE
      // ========================================================

      const updatedBooking =
        await Booking.findById(
          booking._id
        )
          .populate(
            'service',
            'name image'
          )
          .populate(
            'user',
            'firstName lastName email mobile'
          );

      return res.status(200).json({
        success: true,
        message:
          'Booking updated successfully',
        data:
          updatedBooking,
      });

    } catch (error) {
      console.error(
        'Update Booking Error:',
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


// ============================================================
// UPDATE BOOKING ACTIVE STATUS
// 0 = INACTIVE
// 1 = ACTIVE
// ============================================================

updateBookingStatus: async (
  req,
  res
) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    // ========================================================
    // VALIDATE STATUS
    // ========================================================

    if (
      status === undefined ||
      status === null ||
      ![0, 1].includes(Number(status))
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Status is required. Use 0 for inactive or 1 for active',
      });
    }

    const newStatus =
      Number(status);

    // ========================================================
    // FIND BOOKING
    // ========================================================

    const booking =
      await Booking.findOne({
        _id: id,
        user: req.user.id,
      });

    if (!booking) {
      return res.status(404).json({
        success: false,
        message:
          'Booking not found',
      });
    }

    // ========================================================
    // ONLY PENDING BOOKING
    // ========================================================

    if (
      booking.status !== 'PENDING'
    ) {
      return res.status(400).json({
        success: false,
        message:
          'Only pending bookings can be activated or deactivated',
      });
    }

    // ========================================================
    // ALREADY SAME STATUS
    // ========================================================

    if (
      Boolean(booking.isActive) ===
      Boolean(newStatus)
    ) {
      return res.status(400).json({
        success: false,
        message:
          newStatus === 1
            ? 'Booking is already active'
            : 'Booking is already inactive',
      });
    }

    // ========================================================
    // DEACTIVATE
    // ========================================================

    if (newStatus === 0) {
      booking.isActive = false;

      await booking.save();

      // Notify providers that this job is no longer available
      await notifyExistingProvidersUnavailable(
        booking
      );

      return res.status(200).json({
        success: true,
        message:
          'Booking deactivated successfully',
        data: {
          bookingId: booking._id,
          isActive: false,
        },
      });
    }

    // ========================================================
    // ACTIVATE
    // ========================================================

    booking.isActive = true;
    booking.deletedAt = null;

    await booking.save();

    // Find providers again and notify matching providers
    await notifyMatchingProviders(
      booking,
      false
    );

    return res.status(200).json({
      success: true,
      message:
        'Booking activated successfully',
      data: {
        bookingId: booking._id,
        isActive: true,
      },
    });

  } catch (error) {
    console.error(
      'Update Booking Status Error:',
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


  // ============================================================
  // DELETE BOOKING
  // SOFT DELETE
  // ONLY PENDING
  // ============================================================

  deleteBooking: async (
    req,
    res
  ) => {
    try {
        console.log('Delete Booking Request:', req.params);
      const { id } =
        req.params;

      const booking =
        await Booking.findOne({
          _id: id,
          user: req.user.id,
        });

      if (!booking) {
        return res.status(404).json({
          success: false,
          message:
            'Booking not found',
        });
      }

      if (
        booking.status !==
        'PENDING'
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Only pending bookings can be deleted',
        });
      }

      if (
        booking.deletedAt
      ) {
        return res.status(400).json({
          success: false,
          message:
            'Booking is already deleted',
        });
      }

      booking.isActive =
        false;

      booking.deletedAt =
        new Date();

      await booking.save();

      await notifyExistingProvidersUnavailable(
        booking
      );

      return res.status(200).json({
        success: true,
        message:
          'Booking deleted successfully',
      });

    } catch (error) {
      console.error(
        'Delete Booking Error:',
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