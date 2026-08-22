const mongoose = require('mongoose');

const Booking = require('../models/Booking');
const Service = require('../models/Service');
const ProviderProfile = require('../models/ProviderProfile');
const User = require('../models/User');
const Referral = require('../models/Referral');
const BookingOffer = require('../models/BookingOffer');

const { validate } = require('../utils/fieldValidations');
const { calculateDistance } = require('../utils/distance');
const { notifyUser } = require('../utils/notification');
const {
    useBookingCredit,
    addBookingCredits,
} = require('../utils/bookingCredits');


// ============================================================
// NORMALIZE IMAGE PATHS
// ============================================================
const normalizeImagePaths = (images) => {
    if (images === undefined || images === null || images === '') {
        return [];
    }

    let normalized = images;

    if (typeof normalized === 'string') {
        const value = normalized.trim();
        try {
            if (value.startsWith('[')) {
                normalized = JSON.parse(value);
            } else {
                normalized = [value];
            }
        } catch (error) {
            normalized = [value];
        }
    }

    if (!Array.isArray(normalized)) {
        return [];
    }

    return [
        ...new Set(
            normalized
                .filter((image) => typeof image === 'string' && image.trim() !== '')
                .map((image) => image.trim())
        ),
    ];
};

// ============================================================
// NOTIFY MATCHING PROVIDERS
// ============================================================
const notifyMatchingProviders = async (booking, isUpdate = false) => {
    try {
        console.log('\n=============================================');
        console.log('🛎️  STARTING PROVIDER MATCHING PROCESS');
        console.log('Booking ID:', booking._id);

        const service = await Service.findById(booking.service);

        if (!service) {
            console.log('❌ Service not found. Exiting.');
            return;
        }

        if (booking.status !== 'PENDING' || !booking.isActive) {
            console.log('❌ Booking is not active/pending. Exiting.');
            return;
        }

        if (
            !booking.location ||
            !Array.isArray(booking.location.coordinates) ||
            booking.location.coordinates.length !== 2
        ) {
            console.log('❌ Booking lacks valid location coordinates. Exiting.');
            return;
        }

        const [bookingLng, bookingLat] = booking.location.coordinates;
        console.log(`📍 BOOKING LOCATION: [Lat: ${bookingLat}, Lng: ${bookingLng}]`);
        console.log(`🛠️  REQUESTED SERVICE: ${service.name}`);

        const providerProfiles = await ProviderProfile.find({
            services: booking.service,
        }).populate('user', 'firstName lastName email mobile role isActive');

        console.log(`🔍 Found ${providerProfiles.length} provider(s) offering this service.`);

        const currentProviderIds = [];
        const providerDistances = new Map();

        for (const profile of providerProfiles) {
            if (!profile.user) continue;
            if (!profile.user.isActive) continue;

            const providerId = profile.user._id.toString();

            if (providerId === booking.user.toString()) {
                console.log(`⏩ Skipping: ${profile.user.firstName} (Customer cannot match their own booking)`);
                continue;
            }

            // READ FROM profile.location (The ProviderProfile model)
            if (
                !profile.location ||
                !Array.isArray(profile.location.coordinates) ||
                profile.location.coordinates.length !== 2
            ) {
                console.log(`⏩ Skipping: ${profile.user.firstName} (Provider has no location set in work details)`);
                continue;
            }

            const [providerLng, providerLat] = profile.location.coordinates;
            const providerRadius = Number(profile.radius || 0);

            const distance = calculateDistance(
                bookingLat,
                bookingLng,
                providerLat,
                providerLng
            );

            console.log(`\n👨‍🔧 Evaluating Provider: ${profile.user.firstName} ${profile.user.lastName} (${providerId})`);
            console.log(`   - Provider Location: [Lat: ${providerLat}, Lng: ${providerLng}]`);
            console.log(`   - Provider Radius: ${providerRadius} km`);
            console.log(`   - Calculated Distance: ${distance.toFixed(2)} km`);

            if (!Number.isFinite(providerRadius) || providerRadius <= 0) {
                console.log(`   ❌ REJECTED: Provider has an invalid radius.`);
                continue;
            }

            if (distance > providerRadius) {
                console.log(`   ❌ REJECTED: Provider is too far away.`);
                continue;
            }

            console.log(`   ✅ MATCHED: Provider is within range!`);
            currentProviderIds.push(providerId);
            providerDistances.set(providerId, distance);
        }

        console.log('\n📋 --- MATCHING SUMMARY ---');
        console.log(`✅ Total Eligible Providers Nearby: ${currentProviderIds.length}`);
        console.log('=============================================\n');

        const oldProviderIds = (booking.notifiedProviders || []).map((id) => id.toString());
        const newProviderIds = currentProviderIds.filter((id) => !oldProviderIds.includes(id));
        const existingProviderIds = currentProviderIds.filter((id) => oldProviderIds.includes(id));
        const removedProviderIds = oldProviderIds.filter((id) => !currentProviderIds.includes(id));

        for (const providerId of newProviderIds) {
            const distance = providerDistances.get(providerId);
            try {
                await notifyUser({
                    userId: providerId,
                    type: 'NEW_BOOKING_REQUEST',
                    title: 'New Service Request',
                    message: `Someone is looking for ${service.name} at ${
                        booking.address || 'the selected location'
                    }, approximately ${Number(distance).toFixed(1)} km from you.`,
                    bookingId: booking._id,
                    serviceId: service._id,
                    distanceInKm: distance,
                    data: {
                        bookingId: String(booking._id),
                        serviceId: String(service._id),
                        bookingStatus: booking.status,
                        bookingActive: booking.isActive,
                        distance: String(distance),
                        latitude: String(bookingLat),
                        longitude: String(bookingLng),
                    },
                });
            } catch (error) {
                console.error(`New provider notification error for ${providerId}:`, error.message);
            }
        }

        if (isUpdate) {
            for (const providerId of existingProviderIds) {
                const distance = providerDistances.get(providerId);
                try {
                    await notifyUser({
                        userId: providerId,
                        type: 'BOOKING_UPDATED',
                        title: 'Booking Updated',
                        message: `The ${service.name} service request has been updated. Please check the latest details.`,
                        bookingId: booking._id,
                        serviceId: service._id,
                        distanceInKm: distance,
                        data: {
                            bookingId: String(booking._id),
                            serviceId: String(service._id),
                            bookingStatus: booking.status,
                            bookingActive: booking.isActive,
                            distance: String(distance),
                            latitude: String(bookingLat),
                            longitude: String(bookingLng),
                        },
                    });
                } catch (error) {
                    console.error(`Booking update notification error for ${providerId}:`, error.message);
                }
            }

            for (const providerId of removedProviderIds) {
                try {
                    await notifyUser({
                        userId: providerId,
                        type: 'BOOKING_UNAVAILABLE',
                        title: 'Booking No Longer Available',
                        message: `The ${service.name} service request is no longer available for you.`,
                        bookingId: booking._id,
                        serviceId: service._id,
                        data: {
                            bookingId: String(booking._id),
                            serviceId: String(service._id),
                            bookingStatus: booking.status,
                            bookingActive: false,
                        },
                    });
                } catch (error) {
                    console.error(`Booking unavailable notification error for ${providerId}:`, error.message);
                }
            }
        }

        booking.notifiedProviders = currentProviderIds.map((id) => new mongoose.Types.ObjectId(id));
        await booking.save();

    } catch (error) {
        console.error('notifyMatchingProviders Error:', error);
    }
};

// ============================================================
// HELPER: NOTIFY EXISTING PROVIDERS UNAVAILABLE
// ============================================================
const notifyExistingProvidersUnavailable = async (booking) => {
    try {
        const service = await Service.findById(booking.service);

        if (!service) return;

        const providerIds = (booking.notifiedProviders || []).map((id) => id.toString());

        for (const providerId of providerIds) {
            try {
                await notifyUser({
                    userId: providerId,
                    type: 'BOOKING_UNAVAILABLE',
                    title: 'Booking No Longer Available',
                    message: `The ${service.name} service request is no longer available.`,
                    bookingId: booking._id,
                    serviceId: service._id,
                    data: {
                        bookingId: String(booking._id),
                        serviceId: String(service._id),
                        bookingStatus: booking.status,
                        bookingActive: false,
                    },
                });
            } catch (error) {
                console.error(`Booking unavailable notification error for ${providerId}:`, error.message);
            }
        }

        booking.notifiedProviders = [];
        await booking.save();

    } catch (error) {
        console.error('notifyExistingProvidersUnavailable Error:', error);
    }
};

// ============================================================
// CONTROLLER EXPORTS
// ============================================================
module.exports = {

    createBooking: async (req, res) => {
        try {
            const required = ['service', 'latitude', 'longitude'];

            if (validate(req, res, required)) return;

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

            const userId = req.user.id;

            if (Number(req.user.role) !== 0) {
                return res.status(403).json({
                    success: false,
                    message: 'Only customers can create bookings',
                });
            }

            const service = await Service.findOne({ _id: serviceId, isActive: true });

            if (!service) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or inactive service',
                });
            }

            const lat = Number(latitude);
            const lng = Number(longitude);

            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                return res.status(400).json({
                    success: false,
                    message: 'Latitude and longitude must be valid numbers',
                });
            }

            if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid latitude or longitude range',
                });
            }

            const normalizedVisitPreference = visitPreference || 'immediate';

            if (!['immediate', 'scheduled'].includes(normalizedVisitPreference)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid visit preference',
                });
            }

            const normalizedMaterialRequired = materialRequired === true || materialRequired === 'true' || materialRequired === 1 || materialRequired === '1';
            let normalizedMaterialOption = materialOption || null;

            if (normalizedMaterialOption && !['user_has_material', 'provider_brings_material'].includes(normalizedMaterialOption)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid material option',
                });
            }

            if (!normalizedMaterialRequired) {
                normalizedMaterialOption = null;
            }

            let normalizedPreferredDates = [];
            if (preferredDates) {
                try {
                    let dates = typeof preferredDates === 'string' && preferredDates.trim().startsWith('[') 
                        ? JSON.parse(preferredDates) 
                        : typeof preferredDates === 'string' 
                            ? [preferredDates] 
                            : preferredDates;

                    if (!Array.isArray(dates)) throw new Error();

                    normalizedPreferredDates = [...new Set(dates.filter(Boolean).map(date => {
                        const parsed = new Date(date);
                        if (Number.isNaN(parsed.getTime())) return null;
                        return parsed.toISOString().split('T')[0];
                    }).filter(Boolean))].map(date => new Date(date));
                } catch (error) {
                    return res.status(400).json({
                        success: false,
                        message: 'preferredDates must be a valid array',
                    });
                }
            }

            const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
            if (preferredTimeStart && !timeRegex.test(preferredTimeStart.trim())) {
                return res.status(400).json({ success: false, message: 'preferredTimeStart must be in HH:mm format' });
            }
            if (preferredTimeEnd && !timeRegex.test(preferredTimeEnd.trim())) {
                return res.status(400).json({ success: false, message: 'preferredTimeEnd must be in HH:mm format' });
            }

            const workImages = normalizeImagePaths(req.body.images);

            const booking = await Booking.create({
                user: userId,
                service: serviceId,
                provider: null,
                workImages,
                description: description ? description.trim() : '',
                materialRequired: normalizedMaterialRequired,
                materialOption: normalizedMaterialOption,
                location: { type: 'Point', coordinates: [lng, lat] },
                address: address ? address.trim() : '',
                visitPreference: normalizedVisitPreference,
                preferredDates: normalizedPreferredDates,
                preferredTimeStart: preferredTimeStart ? preferredTimeStart.trim() : null,
                preferredTimeEnd: preferredTimeEnd ? preferredTimeEnd.trim() : null,
                status: 'PENDING',
                isActive: true,
                notifiedProviders: [],
            });

            await notifyMatchingProviders(booking, false);

            return res.status(201).json({
                success: true,
                message: 'Your request has been sent to nearby service providers. You can track the status in My Bookings.',
            });

        } catch (error) {
            console.error('Create Booking Error:', error);
            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message,
            });
        }
    },

    updateBooking: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id;

            const booking = await Booking.findOne({ _id: id, user: userId });

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            if (booking.status !== 'PENDING') {
                return res.status(400).json({ success: false, message: 'Booking can only be updated while it is pending' });
            }

            if (!booking.isActive) {
                return res.status(400).json({ success: false, message: 'Inactive booking cannot be updated' });
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

            if (serviceId) {
                const service = await Service.findOne({ _id: serviceId, isActive: true });
                if (!service) return res.status(400).json({ success: false, message: 'Invalid or inactive service' });
                booking.service = serviceId;
            }

            if (latitude !== undefined || longitude !== undefined) {
                const lat = Number(latitude !== undefined ? latitude : booking.location?.coordinates?.[1]);
                const lng = Number(longitude !== undefined ? longitude : booking.location?.coordinates?.[0]);

                if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
                    return res.status(400).json({ success: false, message: 'Invalid latitude or longitude' });
                }

                booking.location = { type: 'Point', coordinates: [lng, lat] };
            }

            if (description !== undefined) booking.description = description ? description.trim() : '';
            if (address !== undefined) booking.address = address ? address.trim() : '';

            if (materialRequired !== undefined) {
                const required = materialRequired === true || materialRequired === 'true' || materialRequired === 1 || materialRequired === '1';
                booking.materialRequired = required;
                if (!required) booking.materialOption = null;
            }

            if (materialOption !== undefined) {
                if (materialOption !== null && !['user_has_material', 'provider_brings_material'].includes(materialOption)) {
                    return res.status(400).json({ success: false, message: 'Invalid material option' });
                }
                if (booking.materialRequired) booking.materialOption = materialOption;
            }

            if (visitPreference !== undefined) {
                if (!['immediate', 'scheduled'].includes(visitPreference)) {
                    return res.status(400).json({ success: false, message: 'Invalid visit preference' });
                }
                booking.visitPreference = visitPreference;
            }

            if (preferredDates !== undefined) {
                try {
                    let dates = typeof preferredDates === 'string' && preferredDates.trim().startsWith('[') 
                        ? JSON.parse(preferredDates) 
                        : typeof preferredDates === 'string' 
                            ? [preferredDates] 
                            : preferredDates;

                    if (!Array.isArray(dates)) throw new Error();

                    booking.preferredDates = [...new Set(dates.filter(Boolean).map(date => {
                        const parsed = new Date(date);
                        if (Number.isNaN(parsed.getTime())) return null;
                        return parsed.toISOString().split('T')[0];
                    }).filter(Boolean))].map(date => new Date(date));
                } catch (error) {
                    return res.status(400).json({ success: false, message: 'preferredDates must be a valid array' });
                }
            }

            const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
            if (preferredTimeStart !== undefined) {
                if (preferredTimeStart && !timeRegex.test(preferredTimeStart.trim())) {
                    return res.status(400).json({ success: false, message: 'preferredTimeStart must be in HH:mm format' });
                }
                booking.preferredTimeStart = preferredTimeStart ? preferredTimeStart.trim() : null;
            }

            if (preferredTimeEnd !== undefined) {
                if (preferredTimeEnd && !timeRegex.test(preferredTimeEnd.trim())) {
                    return res.status(400).json({ success: false, message: 'preferredTimeEnd must be in HH:mm format' });
                }
                booking.preferredTimeEnd = preferredTimeEnd ? preferredTimeEnd.trim() : null;
            }

            if (req.body.images !== undefined) {
                booking.workImages = normalizeImagePaths(req.body.images);
            }

            await booking.save();
            await notifyMatchingProviders(booking, true);

            return res.status(200).json({
                success: true,
                message: 'Your request has been updated and sent to nearby service providers.',
            });

        } catch (error) {
            console.error('Update Booking Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    updateBookingStatus: async (req, res) => {
        try {
            const { id } = req.params;
            const { status } = req.body;

            if (status === undefined || status === null || ![0, 1].includes(Number(status))) {
                return res.status(400).json({ success: false, message: 'Status is required. Use 0 for inactive or 1 for active' });
            }

            const newStatus = Number(status);
            const booking = await Booking.findOne({ _id: id, user: req.user.id });

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            if (booking.status !== 'PENDING') {
                return res.status(400).json({ success: false, message: 'Only pending bookings can be activated or deactivated' });
            }

            if (Boolean(booking.isActive) === Boolean(newStatus)) {
                return res.status(400).json({ success: false, message: newStatus === 1 ? 'Booking is already active' : 'Booking is already inactive' });
            }

            if (newStatus === 0) {
                booking.isActive = false;
                await booking.save();
                await notifyExistingProvidersUnavailable(booking);

                return res.status(200).json({
                    success: true,
                    message: 'Booking deactivated successfully',
                    data: { bookingId: booking._id, isActive: false },
                });
            }

            booking.isActive = true;
            booking.deletedAt = null;
            await booking.save();
            await notifyMatchingProviders(booking, false);

            return res.status(200).json({
                success: true,
                message: 'Booking activated successfully',
                data: { bookingId: booking._id, isActive: true },
            });

        } catch (error) {
            console.error('Update Booking Status Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    deleteBooking: async (req, res) => {
        try {
            const { id } = req.params;
            const booking = await Booking.findOne({ _id: id, user: req.user.id });

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found' });
            }

            if (booking.status !== 'PENDING') {
                return res.status(400).json({ success: false, message: 'Only pending bookings can be deleted' });
            }

            if (booking.deletedAt) {
                return res.status(400).json({ success: false, message: 'Booking is already deleted' });
            }

            booking.isActive = false;
            booking.deletedAt = new Date();
            await booking.save();
            await notifyExistingProvidersUnavailable(booking);

            return res.status(200).json({ success: true, message: 'Booking deleted successfully' });

        } catch (error) {
            console.error('Delete Booking Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    createBookingOffer: async (req, res) => {
        try {
            const { id } = req.params;
            const { offerAmount } = req.body;
            const amount = Number(offerAmount);

            if (!Number.isFinite(amount) || amount < 0) {
                return res.status(400).json({ success: false, message: 'Valid offerAmount is required' });
            }

            const booking = await Booking.findOne({
                _id: id,
                isActive: true,
                status: 'PENDING',
            }).populate('service', 'name');

            if (!booking) {
                return res.status(404).json({ success: false, message: 'Booking not found or no longer available' });
            }

            const isProviderNotified = booking.notifiedProviders && booking.notifiedProviders.some(providerId => providerId.toString() === req.user.id.toString());

            if (!isProviderNotified) {
                return res.status(403).json({ success: false, message: 'You are not eligible for this booking' });
            }

            const existingOffer = await BookingOffer.findOne({ booking: booking._id, provider: req.user.id });

            if (existingOffer) {
                return res.status(400).json({ success: false, message: 'You have already submitted an offer for this booking', data: existingOffer });
            }

            const offer = await BookingOffer.create({
                booking: booking._id,
                provider: req.user.id,
                offerAmount: amount,
                status: 'PENDING',
            });

            await notifyUser({
                userId: booking.user,
                type: 'BOOKING_OFFER_RECEIVED',
                title: 'New Provider Offer',
                message: `A provider submitted an offer of ₹${amount.toFixed(2)} for your service request.`,
                bookingId: booking._id,
                serviceId: booking.service?._id || booking.service,
                data: {
                    bookingId: String(booking._id),
                    offerId: String(offer._id),
                    providerId: String(req.user.id),
                    offerAmount: String(amount),
                    status: offer.status,
                },
            });

            return res.status(201).json({ success: true, message: 'Offer submitted successfully', data: offer });

        } catch (error) {
            console.error('Create Booking Offer Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    acceptBookingOffer: async (req, res) => {
        try {
            const { offerId } = req.params;
            const offer = await BookingOffer.findById(offerId).populate('booking', 'user service status isActive location address');

            if (!offer || !offer.booking) {
                return res.status(404).json({ success: false, message: 'Offer or Booking not found' });
            }

            if (offer.booking.user.toString() !== req.user.id.toString()) {
                return res.status(403).json({ success: false, message: 'You are not authorized to accept this offer' });
            }

            if (!offer.booking.isActive || offer.booking.status !== 'PENDING') {
                return res.status(400).json({ success: false, message: 'This booking is no longer available' });
            }

            if (offer.status !== 'PENDING') {
                return res.status(400).json({ success: false, message: 'This offer cannot be accepted' });
            }

            const approvalMinutes = Number(process.env.PROVIDER_APPROVAL_WINDOW_MINUTES || 10);
            offer.status = 'USER_ACCEPTED';
            offer.userAcceptedAt = new Date();
            offer.providerApprovalExpiresAt = new Date(Date.now() + approvalMinutes * 60 * 1000);
            await offer.save();

            await notifyUser({
                userId: offer.provider,
                type: 'BOOKING_OFFER_ACCEPTED_BY_USER',
                title: 'Your Offer Was Accepted',
                message: 'The customer accepted your offer. Please approve the booking before the approval window expires.',
                bookingId: offer.booking._id,
                serviceId: offer.booking.service,
                data: {
                    bookingId: String(offer.booking._id),
                    offerId: String(offer._id),
                    offerAmount: String(offer.offerAmount),
                    status: offer.status,
                    approvalExpiresAt: offer.providerApprovalExpiresAt,
                },
            });

            return res.status(200).json({ success: true, message: 'Offer accepted. Provider approval is now required.', data: offer });

        } catch (error) {
            console.error('Accept Booking Offer Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    approveBookingOffer: async (req, res) => {
        try {
            const { offerId } = req.params;
            const offer = await BookingOffer.findById(offerId).populate('booking');

            if (!offer || !offer.booking) {
                return res.status(404).json({ success: false, message: 'Offer or Booking not found' });
            }

            if (offer.provider.toString() !== req.user.id.toString()) {
                return res.status(403).json({ success: false, message: 'You are not authorized to approve this offer' });
            }

            const booking = offer.booking;

            if (!booking.isActive || booking.status !== 'PENDING') {
                return res.status(400).json({ success: false, message: 'This booking is no longer available' });
            }

            if (offer.status !== 'USER_ACCEPTED') {
                return res.status(400).json({ success: false, message: 'This offer is not waiting for provider approval' });
            }

            if (offer.providerApprovalExpiresAt && offer.providerApprovalExpiresAt < new Date()) {
                offer.status = 'EXPIRED';
                await offer.save();
                return res.status(400).json({ success: false, message: 'Provider approval window has expired' });
            }

            const provider = await User.findById(req.user.id);
            if (!provider) {
                return res.status(404).json({ success: false, message: 'Provider not found' });
            }

            const providerProfile = await ProviderProfile.findOne({ user: req.user.id });
            if (!providerProfile || !providerProfile.location || !Array.isArray(providerProfile.location.coordinates) || providerProfile.location.coordinates.length !== 2) {
                return res.status(400).json({ success: false, message: 'Provider location is required to calculate job access fee' });
            }

            if (!booking.location || !Array.isArray(booking.location.coordinates) || booking.location.coordinates.length !== 2) {
                return res.status(400).json({ success: false, message: 'Booking location is not available' });
            }

            const [providerLng, providerLat] = providerProfile.location.coordinates;
            const [bookingLng, bookingLat] = booking.location.coordinates;
            const distanceKm = calculateDistance(bookingLat, bookingLng, providerLat, providerLng);
            offer.distanceKm = Number(distanceKm.toFixed(2));

            if (Number(provider.bookingCredits || 0) > 0) {
                const claimedBooking = await Booking.findOneAndUpdate(
                    { _id: booking._id, status: 'PENDING', isActive: true, provider: null },
                    { $set: { provider: req.user.id, status: 'PROVIDER_ACCEPTED', providerAcceptedAt: new Date() } },
                    { new: true }
                );

                if (!claimedBooking) {
                    return res.status(409).json({ success: false, message: 'Another provider has already been assigned this booking', code: 'BOOKING_ALREADY_ASSIGNED' });
                }

                const creditUsed = await useBookingCredit({ providerId: req.user.id, bookingId: booking._id });

                if (!creditUsed) {
                    await Booking.findByIdAndUpdate(booking._id, { $set: { provider: null, status: 'PENDING', providerAcceptedAt: null } });
                    return res.status(403).json({ success: false, message: 'Booking credit could not be used', code: 'BOOKING_CREDIT_ERROR' });
                }

                offer.accessType = 'FREE_CREDIT';
                offer.accessFee = 0;
                offer.paymentStatus = 'NOT_REQUIRED';
                offer.providerApprovedAt = new Date();
                offer.status = 'PROVIDER_APPROVED';
                await offer.save();

                const referral = await Referral.findOne({ referredProvider: req.user.id, status: 'PENDING' });
                if (referral) {
                    const rewardCredits = Number(process.env.PROVIDER_FREE_JOBS_PER_REFERRAL || 0);
                    if (rewardCredits > 0) {
                        await addBookingCredits({ providerId: referral.referrer, amount: rewardCredits, type: 'REFERRAL_REWARD', referral: referral._id, booking: booking._id, description: 'Referral reward for referred provider first approved job' });
                        referral.status = 'SUCCESS';
                        referral.firstBooking = booking._id;
                        referral.successfulAt = new Date();
                        referral.rewardCredits = rewardCredits;
                        await referral.save();
                    }
                }

                await BookingOffer.updateMany(
                    { booking: booking._id, _id: { $ne: offer._id }, status: { $in: ['PENDING', 'USER_ACCEPTED'] } },
                    { $set: { status: 'REJECTED' } }
                );

                return res.status(200).json({
                    success: true,
                    message: 'Booking approved successfully using free booking credit',
                    data: {
                        booking: claimedBooking,
                        offer: offer,
                        bookingCredits: Math.max(0, Number(provider.bookingCredits || 0) - 1),
                    },
                });
            }

            const baseFee = Number(process.env.BOOKING_FEE_BASE || 20);
            const perKmFee = Number(process.env.BOOKING_FEE_PER_KM || 5);
            const accessFee = Number((baseFee + Number(distanceKm) * perKmFee).toFixed(2));

            offer.accessType = 'PAID';
            offer.accessFee = accessFee;
            offer.paymentStatus = 'PENDING';
            await offer.save();

            return res.status(402).json({
                success: false,
                message: 'Payment is required before you can approve this booking',
                code: 'BOOKING_PAYMENT_REQUIRED',
                data: {
                    offerId: offer._id,
                    bookingId: booking._id,
                    distanceKm: offer.distanceKm,
                    accessFee: offer.accessFee,
                    paymentStatus: offer.paymentStatus,
                },
            });

        } catch (error) {
            console.error('Approve Booking Offer Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    proposeVisitTime: async (req, res) => {
        try {
            const { id } = req.params;
            const { visitDate, visitTimeStart, visitTimeEnd } = req.body;

            if (!visitDate) return res.status(400).json({ success: false, message: 'Visit date is required' });

            const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
            if (!visitTimeStart || !timeRegex.test(visitTimeStart)) return res.status(400).json({ success: false, message: 'Valid visitTimeStart is required. Example: 10:00' });
            if (!visitTimeEnd || !timeRegex.test(visitTimeEnd)) return res.status(400).json({ success: false, message: 'Valid visitTimeEnd is required. Example: 12:00' });

            const booking = await Booking.findOne({ _id: id, provider: req.user.id, isActive: true, status: 'PENDING' });
            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found or you are not assigned to this booking' });

            const parsedDate = new Date(visitDate);
            if (isNaN(parsedDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid visit date' });

            booking.providerVisitDate = parsedDate;
            booking.providerVisitTimeStart = visitTimeStart;
            booking.providerVisitTimeEnd = visitTimeEnd;
            booking.dateTimeProposedBy = 'PROVIDER';
            booking.dateTimeStatus = 'PENDING_USER';
            booking.dateTimeUpdatedAt = new Date();

            await booking.save();

            return res.status(200).json({
                success: true,
                message: 'Visit date and time proposed successfully',
                data: {
                    bookingId: booking._id,
                    visitDate: booking.providerVisitDate,
                    visitTimeStart: booking.providerVisitTimeStart,
                    visitTimeEnd: booking.providerVisitTimeEnd,
                    dateTimeStatus: booking.dateTimeStatus,
                },
            });
        } catch (error) {
            console.error('Propose Visit Time Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    acceptVisitTime: async (req, res) => {
        try {
            const { id } = req.params;
            const booking = await Booking.findOne({ _id: id, user: req.user.id, isActive: true, status: 'PENDING' });

            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
            if (booking.dateTimeStatus !== 'PENDING_USER') return res.status(400).json({ success: false, message: 'There is no visit time waiting for your approval' });

            booking.dateTimeStatus = 'CONFIRMED';
            booking.status = 'CONFIRMED';
            booking.dateTimeUpdatedAt = new Date();
            await booking.save();

            return res.status(200).json({ success: true, message: 'Visit date and time accepted successfully', data: booking });

        } catch (error) {
            console.error('Accept Visit Time Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    counterVisitTime: async (req, res) => {
        try {
            const { id } = req.params;
            const { visitDate, visitTimeStart, visitTimeEnd } = req.body;

            if (!visitDate) return res.status(400).json({ success: false, message: 'Visit date is required' });

            const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
            if (!visitTimeStart || !timeRegex.test(visitTimeStart)) return res.status(400).json({ success: false, message: 'Valid visitTimeStart is required' });
            if (!visitTimeEnd || !timeRegex.test(visitTimeEnd)) return res.status(400).json({ success: false, message: 'Valid visitTimeEnd is required' });

            const booking = await Booking.findOne({ _id: id, user: req.user.id, isActive: true, status: 'PENDING' });

            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
            if (booking.dateTimeStatus !== 'PENDING_USER') return res.status(400).json({ success: false, message: 'You cannot counter-propose at this stage' });

            const parsedDate = new Date(visitDate);
            if (isNaN(parsedDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid visit date' });

            booking.providerVisitDate = parsedDate;
            booking.providerVisitTimeStart = visitTimeStart;
            booking.providerVisitTimeEnd = visitTimeEnd;
            booking.dateTimeProposedBy = 'USER';
            booking.dateTimeStatus = 'PENDING_PROVIDER';
            booking.dateTimeUpdatedAt = new Date();

            await booking.save();

            return res.status(200).json({
                success: true,
                message: 'New visit date and time proposed successfully',
                data: {
                    bookingId: booking._id,
                    visitDate: booking.providerVisitDate,
                    visitTimeStart: booking.providerVisitTimeStart,
                    visitTimeEnd: booking.providerVisitTimeEnd,
                    dateTimeStatus: booking.dateTimeStatus,
                },
            });
        } catch (error) {
            console.error('Counter Visit Time Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    acceptCounterVisitTime: async (req, res) => {
        try {
            const { id } = req.params;
            const booking = await Booking.findOne({ _id: id, provider: req.user.id, isActive: true, status: 'PENDING' });

            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
            if (booking.dateTimeStatus !== 'PENDING_PROVIDER') return res.status(400).json({ success: false, message: 'There is no user counter proposal waiting for your approval' });

            booking.dateTimeStatus = 'CONFIRMED';
            booking.status = 'CONFIRMED';
            booking.dateTimeUpdatedAt = new Date();
            await booking.save();

            return res.status(200).json({ success: true, message: 'User proposed visit date and time accepted successfully', data: booking });

        } catch (error) {
            console.error('Accept Counter Visit Time Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },


    // ============================================================
    // UNIFIED: GET MY BOOKINGS (USER & PROVIDER)
    // Filters based on Role and Status parameter
    // ============================================================
    getMyBookings: async (req, res) => {
        try {
            // Allows frontend to pass either ?type= or ?status=
            const statusFilter = req.query.status || req.query.type;
            const userId = req.user.id;
            const role = Number(req.user.role); // 0 = Customer, 1 = Provider

            let query = { deletedAt: null };

            // ============================================================
            // CUSTOMER (Role 0)
            // ============================================================
            if (role === 0) {
                query.user = userId;

                if (statusFilter) {
                    const normalized = statusFilter.toLowerCase().trim();
                    if (normalized === 'pending') {
                        query.status = {
                            $in: ['PENDING', 'PROVIDER_ACCEPTED', 'SCHEDULE_NEGOTIATION'],
                        };
                    } else if (normalized === 'inprogress') {
                        query.status = 'IN_PROGRESS';
                    } else if (normalized === 'completed') {
                        query.status = 'COMPLETED';
                    } else {
                        // Fallback: Allows frontend to query exact statuses like "CONFIRMED"
                        query.status = statusFilter.toUpperCase();
                    }
                }
            } 
            // ============================================================
            // PROVIDER (Role 1)
            // ============================================================
            else if (role === 1) {
                if (statusFilter) {
                    const normalized = statusFilter.toLowerCase().trim();
                    if (normalized === 'new') {
                        // NEW LEADS: Not yet assigned, but provider was notified
                        query.notifiedProviders = userId;
                        query.status = 'PENDING';
                        query.isActive = true;
                    } else if (normalized === 'active' || normalized === 'inprogress') {
                        // ACTIVE JOBS: Formally assigned to the provider
                        query.provider = userId;
                        query.status = { $nin: ['COMPLETED', 'CANCELLED', 'REJECTED', 'PENDING'] };
                    } else if (normalized === 'completed') {
                        // COMPLETED JOBS
                        query.provider = userId;
                        query.status = 'COMPLETED';
                    } else {
                        // Explicit status match for providers
                        query.provider = userId;
                        query.status = statusFilter.toUpperCase();
                    }
                } else {
                    // Default Provider View: Return ALL relevant jobs (New Leads + Active Assignments)
                    query.$or = [
                        { notifiedProviders: userId, status: 'PENDING', isActive: true },
                        { provider: userId }
                    ];
                }
            } else {
                return res.status(403).json({ success: false, message: 'Invalid user role' });
            }

            const bookings = await Booking.find(query)
                .populate('service', 'name image')
                .populate('provider', 'firstName lastName mobile email profileImage')
                .populate('user', 'firstName lastName mobile email profileImage')
                .sort({ createdAt: -1 });

            return res.status(200).json({
                success: true,
                message: 'Bookings fetched successfully',
                filter: statusFilter || 'all',
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
    // UNIFIED: GET BOOKING DETAILS (USER & PROVIDER)
    // Single API enforcing strict access control
    // ============================================================
    getBookingDetails: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id.toString();
            const role = Number(req.user.role);

            const booking = await Booking.findOne({
                _id: id,
                deletedAt: null,
            })
                .populate('user', 'firstName lastName mobile email profileImage')
                .populate('provider', 'firstName lastName mobile email profileImage')
                .populate('service', 'name image');

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found',
                });
            }

            // ============================================================
            // ACCESS CONTROL
            // ============================================================
            let hasAccess = false;

            if (role === 0) {
                // Customer must own the booking
                hasAccess = booking.user && booking.user._id.toString() === userId;
            } else if (role === 1) {
                // Provider must be formally assigned OR have received the lead notification
                const isAssigned = booking.provider && booking.provider._id.toString() === userId;
                const isNotified = booking.notifiedProviders && booking.notifiedProviders.some(pId => pId.toString() === userId);
                
                hasAccess = isAssigned || isNotified;
            }

            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    message: 'You do not have authorization to view this booking',
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

};