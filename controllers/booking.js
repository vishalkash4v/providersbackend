const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const Service = require('../models/Service');
const ProviderProfile = require('../models/ProviderProfile');
const User = require('../models/User');
const Referral = require('../models/Referral');
const BookingOffer = require('../models/BookingOffer');

const { validate } =
    require('../utils/fieldValidations');



const { calculateDistance } =
    require('../utils/distance');

const { notifyUser } =
    require('../utils/notification');

const {
    useBookingCredit,
    addBookingCredits,
} = require('../utils/bookingCredits');


// ============================================================
// NORMALIZE IMAGE PATHS
// ============================================================
//
// Accepts:
//
// images: ["a.jpg", "b.jpg"]
//
// OR form-data:
//
// images: '["a.jpg","b.jpg"]'
//
// OR single string:
//
// images: "a.jpg"
//
// Always returns an array.
// ============================================================

const normalizeImagePaths = (images) => {
    if (
        images === undefined ||
        images === null ||
        images === ''
    ) {
        return [];
    }

    let normalized =
        images;

    // Form-data may send JSON string
    if (typeof normalized === 'string') {
        const value =
            normalized.trim();

        try {
            if (
                value.startsWith('[')
            ) {
                normalized =
                    JSON.parse(value);
            } else {
                normalized = [
                    value,
                ];
            }
        } catch (error) {
            normalized = [
                value,
            ];
        }
    }

    if (!Array.isArray(normalized)) {
        return [];
    }

    return [
        ...new Set(
            normalized
                .filter(
                    (image) =>
                        typeof image ===
                        'string' &&
                        image.trim() !== ''
                )
                .map(
                    (image) =>
                        image.trim()
                )
        ),
    ];
};


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
                        `Someone is looking for ${service.name} at ${booking.address ||
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

            // ========================================================
            // WORK IMAGES
            // ========================================================

            const workImages =
                normalizeImagePaths(
                    req.body.images
                );

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

            return res.status(201).json({
                success: true,
                message:
                    'Booking created successfully',
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
            // WORK IMAGES
            // ========================================================
            //
            // If images is provided:
            // replace existing booking images.
            //
            // If images is not provided:
            // keep existing images unchanged.
            // ========================================================

            if (
                req.body.images !==
                undefined
            ) {
                booking.workImages =
                    normalizeImagePaths(
                        req.body.images
                    );
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

            return res.status(200).json({
                success: true,
                message:
                    'Booking updated successfully',
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

    createBookingOffer: async (req, res) => {
        try {
            const { id } = req.params;
            const { offerAmount } = req.body;

            const amount = Number(offerAmount);

            if (!Number.isFinite(amount) || amount < 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid offerAmount is required',
                });
            }

            const booking = await Booking.findOne({
                _id: id,
                isActive: true,
                status: 'PENDING',
            }).populate('service', 'name');

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Booking not found or no longer available',
                });
            }

            // Provider must have received this booking request
            const isProviderNotified =
                booking.notifiedProviders &&
                booking.notifiedProviders.some(
                    providerId =>
                        providerId.toString() ===
                        req.user.id.toString()
                );

            if (!isProviderNotified) {
                return res.status(403).json({
                    success: false,
                    message:
                        'You are not eligible for this booking',
                });
            }

            // One provider can submit only one offer
            const existingOffer =
                await BookingOffer.findOne({
                    booking: booking._id,
                    provider: req.user.id,
                });

            if (existingOffer) {
                return res.status(400).json({
                    success: false,
                    message:
                        'You have already submitted an offer for this booking',
                    data: existingOffer,
                });
            }

            const offer =
                await BookingOffer.create({
                    booking:
                        booking._id,

                    provider:
                        req.user.id,

                    offerAmount:
                        amount,

                    status:
                        'PENDING',
                });

            await notifyUser({
                userId:
                    booking.user,

                type:
                    'BOOKING_OFFER_RECEIVED',

                title:
                    'New Provider Offer',

                message:
                    `A provider submitted an offer of ₹${amount.toFixed(2)} for your service request.`,

                bookingId:
                    booking._id,

                serviceId:
                    booking.service?._id ||
                    booking.service,

                data: {
                    bookingId:
                        String(booking._id),

                    offerId:
                        String(offer._id),

                    providerId:
                        String(req.user.id),

                    offerAmount:
                        String(amount),

                    status:
                        offer.status,
                },
            });

            return res.status(201).json({
                success: true,
                message:
                    'Offer submitted successfully',
                data:
                    offer,
            });

        } catch (error) {
            console.error(
                'Create Booking Offer Error:',
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
    acceptBookingOffer: async (req, res) => {
        try {
            const { offerId } =
                req.params;

            const offer =
                await BookingOffer.findById(
                    offerId
                ).populate(
                    'booking',
                    'user service status isActive location address'
                );

            if (!offer) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Offer not found',
                });
            }

            if (!offer.booking) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Booking not found',
                });
            }

            // Only booking owner can accept offer
            if (
                offer.booking.user.toString() !==
                req.user.id.toString()
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        'You are not authorized to accept this offer',
                });
            }

            if (
                !offer.booking.isActive ||
                offer.booking.status !==
                'PENDING'
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'This booking is no longer available',
                });
            }

            if (
                offer.status !==
                'PENDING'
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'This offer cannot be accepted',
                });
            }

            const approvalMinutes =
                Number(
                    process.env
                        .PROVIDER_APPROVAL_WINDOW_MINUTES ||
                    10
                );

            offer.status =
                'USER_ACCEPTED';

            offer.userAcceptedAt =
                new Date();

            offer.providerApprovalExpiresAt =
                new Date(
                    Date.now() +
                    approvalMinutes *
                    60 *
                    1000
                );

            await offer.save();

            // Notify provider
            await notifyUser({
                userId:
                    offer.provider,

                type:
                    'BOOKING_OFFER_ACCEPTED_BY_USER',

                title:
                    'Your Offer Was Accepted',

                message:
                    'The customer accepted your offer. Please approve the booking before the approval window expires.',

                bookingId:
                    offer.booking._id,

                serviceId:
                    offer.booking.service,

                data: {
                    bookingId:
                        String(
                            offer.booking._id
                        ),

                    offerId:
                        String(
                            offer._id
                        ),

                    offerAmount:
                        String(
                            offer.offerAmount
                        ),

                    status:
                        offer.status,

                    approvalExpiresAt:
                        offer.providerApprovalExpiresAt,
                },
            });

            return res.status(200).json({
                success: true,

                message:
                    'Offer accepted. Provider approval is now required.',

                data:
                    offer,
            });

        } catch (error) {
            console.error(
                'Accept Booking Offer Error:',
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

    approveBookingOffer: async (req, res) => {
        try {
            const { offerId } =
                req.params;

            const offer =
                await BookingOffer.findById(
                    offerId
                ).populate('booking');

            if (!offer) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Offer not found',
                });
            }

            // Only offer's provider can approve
            if (
                offer.provider.toString() !==
                req.user.id.toString()
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        'You are not authorized to approve this offer',
                });
            }

            if (!offer.booking) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Booking not found',
                });
            }

            const booking =
                offer.booking;

            if (
                !booking.isActive ||
                booking.status !==
                'PENDING'
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'This booking is no longer available',
                });
            }

            if (
                offer.status !==
                'USER_ACCEPTED'
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'This offer is not waiting for provider approval',
                });
            }

            // Approval time expired
            if (
                offer.providerApprovalExpiresAt &&
                offer.providerApprovalExpiresAt <
                new Date()
            ) {
                offer.status =
                    'EXPIRED';

                await offer.save();

                return res.status(400).json({
                    success: false,
                    message:
                        'Provider approval window has expired',
                });
            }

            const provider =
                await User.findById(
                    req.user.id
                );

            if (!provider) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Provider not found',
                });
            }

            // ========================================================
            // PROVIDER LOCATION
            // ========================================================

            const providerProfile =
                await ProviderProfile.findOne({
                    user:
                        req.user.id,
                });

            if (
                !providerProfile ||
                !providerProfile.location ||
                !Array.isArray(
                    providerProfile.location
                        .coordinates
                ) ||
                providerProfile.location
                    .coordinates
                    .length !== 2
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Provider location is required to calculate job access fee',
                });
            }

            if (
                !booking.location ||
                !Array.isArray(
                    booking.location
                        .coordinates
                ) ||
                booking.location
                    .coordinates
                    .length !== 2
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Booking location is not available',
                });
            }

            const [
                providerLng,
                providerLat,
            ] =
                providerProfile.location
                    .coordinates;

            const [
                bookingLng,
                bookingLat,
            ] =
                booking.location
                    .coordinates;

            const distanceKm =
                calculateDistance(
                    bookingLat,
                    bookingLng,
                    providerLat,
                    providerLng
                );

            offer.distanceKm =
                Number(
                    distanceKm.toFixed(2)
                );

            // ========================================================
            // FREE CREDIT
            // ========================================================

            if (
                Number(
                    provider.bookingCredits || 0
                ) > 0
            ) {
                // Atomic booking claim.
                // First provider to successfully claim wins.
                const claimedBooking =
                    await Booking.findOneAndUpdate(
                        {
                            _id:
                                booking._id,

                            status:
                                'PENDING',

                            isActive:
                                true,

                            provider:
                                null,
                        },
                        {
                            $set: {
                                provider:
                                    req.user.id,

                                status:
                                    'PROVIDER_ACCEPTED',

                                providerAcceptedAt:
                                    new Date(),
                            },
                        },
                        {
                            new: true,
                        }
                    );

                if (!claimedBooking) {
                    return res.status(409).json({
                        success: false,
                        message:
                            'Another provider has already been assigned this booking',
                        code:
                            'BOOKING_ALREADY_ASSIGNED',
                    });
                }

                const creditUsed =
                    await useBookingCredit({
                        providerId:
                            req.user.id,

                        bookingId:
                            booking._id,
                    });

                if (!creditUsed) {
                    // Rollback booking assignment
                    await Booking.findByIdAndUpdate(
                        booking._id,
                        {
                            $set: {
                                provider:
                                    null,

                                status:
                                    'PENDING',

                                providerAcceptedAt:
                                    null,
                            },
                        }
                    );

                    return res.status(403).json({
                        success: false,
                        message:
                            'Booking credit could not be used',
                        code:
                            'BOOKING_CREDIT_ERROR',
                    });
                }

                offer.accessType =
                    'FREE_CREDIT';

                offer.accessFee =
                    0;

                offer.paymentStatus =
                    'NOT_REQUIRED';

                offer.providerApprovedAt =
                    new Date();

                offer.status =
                    'PROVIDER_APPROVED';

                await offer.save();

                // ====================================================
                // REFERRAL SUCCESS
                // ====================================================

                const referral =
                    await Referral.findOne({
                        referredProvider:
                            req.user.id,

                        status:
                            'PENDING',
                    });

                if (referral) {
                    const rewardCredits =
                        Number(
                            process.env
                                .PROVIDER_FREE_JOBS_PER_REFERRAL ||
                            0
                        );

                    if (
                        rewardCredits > 0
                    ) {
                        await addBookingCredits({
                            providerId:
                                referral.referrer,

                            amount:
                                rewardCredits,

                            type:
                                'REFERRAL_REWARD',

                            referral:
                                referral._id,

                            booking:
                                booking._id,

                            description:
                                'Referral reward for referred provider first approved job',
                        });

                        referral.status =
                            'SUCCESS';

                        referral.firstBooking =
                            booking._id;

                        referral.successfulAt =
                            new Date();

                        referral.rewardCredits =
                            rewardCredits;

                        await referral.save();
                    }
                }

                // Other accepted/pending offers lose the race
                await BookingOffer.updateMany(
                    {
                        booking:
                            booking._id,

                        _id: {
                            $ne:
                                offer._id,
                        },

                        status: {
                            $in: [
                                'PENDING',
                                'USER_ACCEPTED',
                            ],
                        },
                    },
                    {
                        $set: {
                            status:
                                'REJECTED',
                        },
                    }
                );

                return res.status(200).json({
                    success: true,

                    message:
                        'Booking approved successfully using free booking credit',

                    data: {
                        booking:
                            claimedBooking,

                        offer:
                            offer,

                        bookingCredits:
                            Math.max(
                                0,
                                Number(
                                    provider.bookingCredits ||
                                    0
                                ) - 1
                            ),
                    },
                });
            }

            // ========================================================
            // NO FREE CREDIT
            // CALCULATE PAYMENT
            // ========================================================

            const baseFee =
                Number(
                    process.env
                        .BOOKING_FEE_BASE ||
                    20
                );

            const perKmFee =
                Number(
                    process.env
                        .BOOKING_FEE_PER_KM ||
                    5
                );

            const accessFee =
                Number(
                    (
                        baseFee +
                        Number(
                            distanceKm
                        ) *
                        perKmFee
                    ).toFixed(2)
                );

            offer.accessType =
                'PAID';

            offer.accessFee =
                accessFee;

            offer.paymentStatus =
                'PENDING';

            await offer.save();

            return res.status(402).json({
                success: false,

                message:
                    'Payment is required before you can approve this booking',

                code:
                    'BOOKING_PAYMENT_REQUIRED',

                data: {
                    offerId:
                        offer._id,

                    bookingId:
                        booking._id,

                    distanceKm:
                        offer.distanceKm,

                    accessFee:
                        offer.accessFee,

                    paymentStatus:
                        offer.paymentStatus,
                },
            });

        } catch (error) {
            console.error(
                'Approve Booking Offer Error:',
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

    proposeVisitTime: async (req, res) => {
        try {
            const { id } = req.params;

            const {
                visitDate,
                visitTimeStart,
                visitTimeEnd,
            } = req.body;

            if (!visitDate) {
                return res.status(400).json({
                    success: false,
                    message: 'Visit date is required',
                });
            }

            const timeRegex =
                /^([01]\d|2[0-3]):([0-5]\d)$/;

            if (
                !visitTimeStart ||
                !timeRegex.test(visitTimeStart)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid visitTimeStart is required. Example: 10:00',
                });
            }

            if (
                !visitTimeEnd ||
                !timeRegex.test(visitTimeEnd)
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Valid visitTimeEnd is required. Example: 12:00',
                });
            }

            const booking = await Booking.findOne({
                _id: id,
                provider: req.user.id,
                isActive: true,
                status: 'PENDING',
            });

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message:
                        'Booking not found or you are not assigned to this booking',
                });
            }

            const parsedDate = new Date(visitDate);

            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid visit date',
                });
            }

            booking.providerVisitDate = parsedDate;
            booking.providerVisitTimeStart = visitTimeStart;
            booking.providerVisitTimeEnd = visitTimeEnd;

            booking.dateTimeProposedBy = 'PROVIDER';
            booking.dateTimeStatus = 'PENDING_USER';
            booking.dateTimeUpdatedAt = new Date();

            await booking.save();

            return res.status(200).json({
                success: true,
                message:
                    'Visit date and time proposed successfully',
                data: {
                    bookingId: booking._id,
                    visitDate: booking.providerVisitDate,
                    visitTimeStart:
                        booking.providerVisitTimeStart,
                    visitTimeEnd:
                        booking.providerVisitTimeEnd,
                    dateTimeStatus:
                        booking.dateTimeStatus,
                },
            });

        } catch (error) {
            console.error(
                'Propose Visit Time Error:',
                error
            );

            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message,
            });
        }
    },

    acceptVisitTime: async (req, res) => {
        try {
            const { id } = req.params;

            const booking = await Booking.findOne({
                _id: id,
                user: req.user.id,
                isActive: true,
                status: 'PENDING',
            });

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found',
                });
            }

            if (
                booking.dateTimeStatus !==
                'PENDING_USER'
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'There is no visit time waiting for your approval',
                });
            }

            booking.dateTimeStatus =
                'CONFIRMED';

            booking.status =
                'CONFIRMED';

            booking.dateTimeUpdatedAt =
                new Date();

            await booking.save();

            return res.status(200).json({
                success: true,
                message:
                    'Visit date and time accepted successfully',
                data: booking,
            });

        } catch (error) {
            console.error(
                'Accept Visit Time Error:',
                error
            );

            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message,
            });
        }
    },

    counterVisitTime: async (req, res) => {
        try {
            const { id } = req.params;

            const {
                visitDate,
                visitTimeStart,
                visitTimeEnd,
            } = req.body;

            if (!visitDate) {
                return res.status(400).json({
                    success: false,
                    message: 'Visit date is required',
                });
            }

            const timeRegex =
                /^([01]\d|2[0-3]):([0-5]\d)$/;

            if (
                !visitTimeStart ||
                !timeRegex.test(visitTimeStart)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid visitTimeStart is required',
                });
            }

            if (
                !visitTimeEnd ||
                !timeRegex.test(visitTimeEnd)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'Valid visitTimeEnd is required',
                });
            }

            const booking = await Booking.findOne({
                _id: id,
                user: req.user.id,
                isActive: true,
                status: 'PENDING',
            });

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found',
                });
            }

            if (
                booking.dateTimeStatus !==
                'PENDING_USER'
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'You cannot counter-propose at this stage',
                });
            }

            const parsedDate =
                new Date(visitDate);

            if (isNaN(parsedDate.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid visit date',
                });
            }

            booking.providerVisitDate =
                parsedDate;

            booking.providerVisitTimeStart =
                visitTimeStart;

            booking.providerVisitTimeEnd =
                visitTimeEnd;

            booking.dateTimeProposedBy =
                'USER';

            booking.dateTimeStatus =
                'PENDING_PROVIDER';

            booking.dateTimeUpdatedAt =
                new Date();

            await booking.save();

            return res.status(200).json({
                success: true,
                message:
                    'New visit date and time proposed successfully',
                data: {
                    bookingId: booking._id,
                    visitDate:
                        booking.providerVisitDate,
                    visitTimeStart:
                        booking.providerVisitTimeStart,
                    visitTimeEnd:
                        booking.providerVisitTimeEnd,
                    dateTimeStatus:
                        booking.dateTimeStatus,
                },
            });

        } catch (error) {
            console.error(
                'Counter Visit Time Error:',
                error
            );

            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message,
            });
        }
    },

    acceptCounterVisitTime: async (
        req,
        res
    ) => {
        try {
            const { id } = req.params;

            const booking =
                await Booking.findOne({
                    _id: id,
                    provider: req.user.id,
                    isActive: true,
                    status: 'PENDING',
                });

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found',
                });
            }

            if (
                booking.dateTimeStatus !==
                'PENDING_PROVIDER'
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        'There is no user counter proposal waiting for your approval',
                });
            }

            booking.dateTimeStatus =
                'CONFIRMED';

            booking.status =
                'CONFIRMED';

            booking.dateTimeUpdatedAt =
                new Date();

            await booking.save();

            return res.status(200).json({
                success: true,
                message:
                    'User proposed visit date and time accepted successfully',
                data: booking,
            });

        } catch (error) {
            console.error(
                'Accept Counter Visit Time Error:',
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
    // GET MY BOOKINGS - USER
    // ============================================================

    getMyBookings: async (req, res) => {
        try {
            const { type } = req.query;

            const query = {
                user: req.user.id,
                deletedAt: null,
            };

            // ============================================================
            // BOOKING TYPE FILTER
            // ============================================================

            if (type) {
                const normalizedType = type.toLowerCase().trim();

                if (normalizedType === 'pending') {
                    query.status = {
                        $in: [
                            'PENDING',
                            'PROVIDER_ACCEPTED',
                            'SCHEDULE_NEGOTIATION',
                        ],
                    };
                } else if (normalizedType === 'inprogress') {
                    query.status = 'IN_PROGRESS';
                } else if (normalizedType === 'completed') {
                    query.status = 'COMPLETED';
                } else {
                    return res.status(400).json({
                        success: false,
                        message:
                            'Invalid type. Use pending, inprogress or completed',
                    });
                }
            }

            const bookings = await Booking.find(query)
                .populate('service', 'name image')
                .populate(
                    'provider',
                    'firstName lastName mobile email profileImage'
                )
                .sort({ createdAt: -1 });

            return res.status(200).json({
                success: true,
                message: 'Bookings fetched successfully',
                type: type || 'all',
                count: bookings.length,
                data: bookings,
            });
        } catch (error) {
            console.error('Get My Bookings Error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message,
            });
        }
    },

    // ============================================================
    // GET BOOKING DETAILS - USER / PROVIDER
    // ============================================================

    getBookingDetails: async (req, res) => {
        try {
            const { id } = req.params;

            const booking = await Booking.findOne({
                _id: id,
                deletedAt: null,
            })
                .populate(
                    'user',
                    'firstName lastName mobile email profileImage'
                )
                .populate(
                    'provider',
                    'firstName lastName mobile email profileImage'
                )
                .populate('service', 'name image');

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found',
                });
            }

            // Only booking owner or assigned provider can see details
            const userId = req.user.id.toString();

            const isUser =
                booking.user &&
                booking.user._id.toString() === userId;

            const isProvider =
                booking.provider &&
                booking.provider._id.toString() === userId;

            if (!isUser && !isProvider) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not authorized to view this booking',
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Booking details fetched successfully',
                data: booking,
            });
        } catch (error) {
            console.error('Get Booking Details Error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message,
            });
        }
    },

    // ============================================================
    // GET PROVIDER JOBS
    // ============================================================

    getProviderJobs: async (req, res) => {
        try {
            const providerId = req.user.id;

            const bookings = await Booking.find({
                provider: providerId,
                deletedAt: null,
                isActive: true,
            })
                .populate(
                    'user',
                    'firstName lastName mobile email profileImage'
                )
                .populate('service', 'name image')
                .sort({ createdAt: -1 });

            return res.status(200).json({
                success: true,
                message: 'Provider jobs fetched successfully',
                count: bookings.length,
                data: bookings,
            });
        } catch (error) {
            console.error('Get Provider Jobs Error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message,
            });
        }
    },

    // ============================================================
    // GET PROVIDER JOB DETAILS
    // ============================================================

    getProviderJobDetails: async (req, res) => {
        try {
            const { id } = req.params;

            const booking = await Booking.findOne({
                _id: id,
                provider: req.user.id,
                deletedAt: null,
            })
                .populate(
                    'user',
                    'firstName lastName mobile email profileImage'
                )
                .populate('provider', 'firstName lastName mobile email profileImage')
                .populate('service', 'name image');

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Job not found',
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Job details fetched successfully',
                data: booking,
            });
        } catch (error) {
            console.error('Get Provider Job Details Error:', error);

            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message,
            });
        }
    },

};