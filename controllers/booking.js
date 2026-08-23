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
const { useBookingCredit, addBookingCredits } = require('../utils/bookingCredits');


// ============================================================
// NORMALIZE IMAGE PATHS
// ============================================================
const normalizeImagePaths = (images) => {
    if (images === undefined || images === null || images === '') return [];
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
    if (!Array.isArray(normalized)) return [];
    return [...new Set(normalized.filter((image) => typeof image === 'string' && image.trim() !== '').map((image) => image.trim()))];
};

// ============================================================
// NOTIFY MATCHING PROVIDERS (WITH DYNAMIC UPDATE MESSAGES)
// ============================================================
const notifyMatchingProviders = async (booking, isUpdate = false, updateMessage = null) => {
    try {
        const serviceId = booking.service?._id ? booking.service._id : booking.service;
        const service = await Service.findById(serviceId);
        if (!service) return;

        if (booking.status !== 0 || !booking.isActive || booking.deletedAt) return;
        if (!booking.location || !Array.isArray(booking.location.coordinates) || booking.location.coordinates.length !== 2) return;

        const [bookingLng, bookingLat] = booking.location.coordinates;

        const providerProfiles = await ProviderProfile.find({
            services: new mongoose.Types.ObjectId(serviceId),
        }).populate('user', 'firstName lastName email mobile role isActive');

        const currentProviderIds = [];
        const providerDistances = new Map();

        for (const profile of providerProfiles) {
            if (!profile.user || !profile.user.isActive) continue;

            const providerId = profile.user._id.toString();
            const customerId = booking.user?._id ? booking.user._id.toString() : booking.user.toString();
            if (providerId === customerId) continue;

            if (!profile.location || !Array.isArray(profile.location.coordinates) || profile.location.coordinates.length !== 2) continue;

            const [providerLng, providerLat] = profile.location.coordinates;
            const providerRadius = Number(profile.radius || 0);

            if (providerLng === 0 && providerLat === 0) continue;

            const distance = calculateDistance(bookingLat, bookingLng, providerLat, providerLng);
            if (!Number.isFinite(providerRadius) || providerRadius <= 0 || distance > providerRadius) continue;

            currentProviderIds.push(providerId);
            providerDistances.set(providerId, distance);
        }

        const oldProviderIds = (booking.notifiedProviders || []).map((id) => id.toString());
        const newProviderIds = currentProviderIds.filter((id) => !oldProviderIds.includes(id));
        const existingProviderIds = currentProviderIds.filter((id) => oldProviderIds.includes(id));
        const removedProviderIds = oldProviderIds.filter((id) => !currentProviderIds.includes(id));

        // 1. Notify completely NEW providers
        for (const providerId of newProviderIds) {
            const distance = providerDistances.get(providerId);
            try {
                await notifyUser({
                    userId: providerId,
                    type: 'NEW_BOOKING_REQUEST',
                    title: 'New Service Request',
                    message: `Someone is looking for ${service.name} approximately ${Number(distance).toFixed(1)} km from you.`,
                    bookingId: booking._id,
                    serviceId: service._id,
                });
            } catch (error) { }
        }

        // 2. Notify EXISTING providers of UPDATES
        if (isUpdate) {
            const defaultMsg = `The ${service.name} service request has been updated.`;
            for (const providerId of existingProviderIds) {
                try {
                    await notifyUser({
                        userId: providerId,
                        type: 'BOOKING_UPDATED',
                        title: 'Booking Updated',
                        message: updateMessage || defaultMsg, // Custom message inserted here!
                        bookingId: booking._id,
                    });
                } catch (error) { }
            }

            // Notify providers who are no longer in range (e.g. location changed)
            for (const providerId of removedProviderIds) {
                try {
                    await notifyUser({
                        userId: providerId,
                        type: 'BOOKING_UNAVAILABLE',
                        title: 'Booking Out of Range',
                        message: `The ${service.name} request location was updated and is no longer in your radius.`,
                        bookingId: booking._id,
                    });
                } catch (error) { }
            }
        }

        booking.notifiedProviders = currentProviderIds.map((id) => new mongoose.Types.ObjectId(id));
        await booking.save();
    } catch (error) {
        console.error('notifyMatchingProviders Error:', error);
    }
};

const notifyExistingProvidersUnavailable = async (booking, customMessage = null) => {
    try {
        const serviceId = booking.service?._id ? booking.service._id : booking.service;
        const service = await Service.findById(serviceId);
        if (!service) return;

        const providerIds = (booking.notifiedProviders || []).map((id) => id.toString());
        const msg = customMessage || `The ${service.name} request has been cancelled or assigned.`;

        for (const providerId of providerIds) {
            try {
                await notifyUser({
                    userId: providerId,
                    type: 'BOOKING_UNAVAILABLE',
                    title: 'Booking Cancelled/Unavailable',
                    message: msg,
                    bookingId: booking._id,
                });
            } catch (error) { }
        }
        booking.notifiedProviders = [];
        await booking.save();
    } catch (error) { }
};

// ============================================================
// CONTROLLER EXPORTS
// ============================================================
module.exports = {

    createBooking: async (req, res) => {
        try {
            const required = ['service', 'latitude', 'longitude'];
            if (validate(req, res, required)) return;

            const { service: serviceId, description, materialRequired, materialOption, latitude, longitude, address, visitPreference, preferredDates, preferredTimeStart, preferredTimeEnd } = req.body;
            const userId = req.user.id;

            if (Number(req.user.role) !== 0) return res.status(403).json({ success: false, message: 'Only customers can create bookings' });

            const service = await Service.findOne({ _id: serviceId, isActive: true });
            if (!service) return res.status(400).json({ success: false, message: 'Invalid service' });

            const lat = Number(latitude);
            const lng = Number(longitude);

            const booking = await Booking.create({
                user: userId,
                service: serviceId,
                provider: null,
                workImages: normalizeImagePaths(req.body.images),
                description: description ? description.trim() : '',
                materialRequired: Boolean(materialRequired),
                materialOption: materialOption || null,
                location: { type: 'Point', coordinates: [lng, lat] },
                address: address ? address.trim() : '',
                visitPreference: visitPreference || 'immediate',
                status: 0, // 0 = Pending
                isActive: true,
                deletedAt: null,
                notifiedProviders: [],
            });

            await notifyMatchingProviders(booking, false);

            return res.status(201).json({
                success: true,
                message: 'Your request has been sent to nearby service providers. You can view details in My Bookings.'
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    updateBooking: async (req, res) => {
        try {
            const booking = await Booking.findOne({ _id: req.params.id, user: req.user.id });
            if (!booking || booking.deletedAt) return res.status(404).json({ success: false, message: 'Booking not found' });
            if (booking.status !== 0) return res.status(400).json({ success: false, message: 'Booking can only be updated while pending' });

            // Detect what is changing to send the right notification
            let updateMessage = 'The service request details have been updated by the customer.';

            if (req.body.latitude || req.body.longitude || req.body.address) {
                updateMessage = 'The location/address for the service request has been changed.';
                if (req.body.latitude && req.body.longitude) {
                    booking.location = { type: 'Point', coordinates: [Number(req.body.longitude), Number(req.body.latitude)] };
                }
                if (req.body.address) booking.address = req.body.address;
            } else if (req.body.preferredDates || req.body.preferredTimeStart || req.body.preferredTimeEnd) {
                updateMessage = 'The preferred date and time for the service request has been changed.';
                if (req.body.preferredDates) booking.preferredDates = req.body.preferredDates;
                if (req.body.preferredTimeStart) booking.preferredTimeStart = req.body.preferredTimeStart;
                if (req.body.preferredTimeEnd) booking.preferredTimeEnd = req.body.preferredTimeEnd;
            } else if (req.body.description || req.body.materialRequired !== undefined) {
                updateMessage = 'The description or material requirements for the service request have been updated.';
                if (req.body.description) booking.description = req.body.description;
                if (req.body.materialRequired !== undefined) booking.materialRequired = req.body.materialRequired;
            }

            await booking.save();

            // Pass the custom message to the notification function
            await notifyMatchingProviders(booking, true, updateMessage);

            return res.status(200).json({
                success: true,
                message: 'Your request has been updated and nearby providers have been notified.',
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    deleteBooking: async (req, res) => {
        try {
            const booking = await Booking.findOne({ _id: req.params.id, user: req.user.id });
            if (!booking || booking.deletedAt) return res.status(404).json({ success: false, message: 'Booking not found' });
            if (booking.status === 2) return res.status(400).json({ success: false, message: 'Completed bookings cannot be deleted' });

            const previousStatus = booking.status;
            const assignedProvider = booking.provider;

            // Soft Delete
            booking.isActive = false;
            booking.deletedAt = new Date();
            await booking.save();

            if (previousStatus === 1 && assignedProvider) {
                // If it was already confirmed with a provider, notify them specifically
                try {
                    await notifyUser({
                        userId: assignedProvider,
                        type: 'BOOKING_CANCELLED_BY_USER',
                        title: 'Confirmed Booking Cancelled',
                        message: 'The customer has cancelled the booking after it was assigned to you.',
                        bookingId: booking._id,
                    });

                    await BookingOffer.findOneAndUpdate(
                        { booking: booking._id, provider: assignedProvider, status: 3 },
                        { $set: { status: 2, rejectionReason: 'Customer cancelled the booking after confirmation' } }
                    );
                } catch (error) { }
            } else {
                // If it was still pending, notify all notified providers
                await notifyExistingProvidersUnavailable(booking, 'The customer has cancelled this service request.');

                // Mark all pending offers for this booking as rejected
                await BookingOffer.updateMany(
                    { booking: booking._id, status: { $in: [0, 1] } },
                    { $set: { status: 2, rejectionReason: 'Customer cancelled the service request' } }
                );
            }

            return res.status(200).json({ success: true, message: 'Booking cancelled successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },



    // ============================================================
    // OFFERS MANAGEMENT
    // ============================================================
   // ============================================================
    // CREATE BOOKING OFFER (Supports Resubmission)
    // ============================================================
    createBookingOffer: async (req, res) => {
        try {
            const { id } = req.params;
            const amount = Number(req.body.offerAmount);
            const proposedDate = req.body.proposedDate;
            const proposedTime = req.body.proposedTime;

            if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ success: false, message: 'Valid offerAmount is required' });

            const booking = await Booking.findOne({ _id: id, isActive: true, status: 0, deletedAt: null }).populate('service', 'name');
            if (!booking) return res.status(404).json({ success: false, message: 'Booking not available' });

            const isProviderNotified = booking.notifiedProviders.some(pId => pId.toString() === req.user.id.toString());
            if (!isProviderNotified) return res.status(403).json({ success: false, message: 'You are not eligible for this booking' });

            const providerProfile = await ProviderProfile.findOne({ user: req.user.id });
            const [pLng, pLat] = providerProfile.location.coordinates;
            const [bLng, bLat] = booking.location.coordinates;
            const distanceKm = calculateDistance(bLat, bLng, pLat, pLng);

            let offer = await BookingOffer.findOne({ booking: booking._id, provider: req.user.id });
            
            if (offer) {
                // Agar offer pehle Reject(2), Cancel(4) ya Timeout(5) ho chuka hai, toh usko wapas Pending(0) kardo!
                if ([2, 4, 5].includes(offer.status)) {
                    offer.offerAmount = amount;
                    offer.proposedDate = proposedDate ? String(proposedDate).trim() : null;
                    offer.proposedTime = proposedTime ? String(proposedTime).trim() : null;
                    offer.distanceKm = Number(distanceKm.toFixed(2));
                    offer.status = 0; // Wapas Pending kar diya
                    offer.rejectionReason = null; // Purana rejection clear kar diya
                    offer.userAcceptedAt = null;
                    offer.providerApprovalExpiresAt = null;
                    await offer.save();
                    
                    return res.status(200).json({ success: true, message: 'Offer resubmitted successfully', data: offer });
                } else {
                    // Agar already 0 (Pending) ya 1 (Accepted) hai, toh error do
                    return res.status(400).json({ success: false, message: 'You already have an active offer for this booking' });
                }
            }

            // Agar pehli baar offer bhej raha hai
            offer = await BookingOffer.create({
                booking: booking._id,
                provider: req.user.id,
                offerAmount: amount,
                proposedDate: proposedDate ? String(proposedDate).trim() : null,
                proposedTime: proposedTime ? String(proposedTime).trim() : null,
                distanceKm: Number(distanceKm.toFixed(2)),
                status: 0, // 0 = Pending
            });

            return res.status(201).json({ success: true, message: 'Offer submitted', data: offer });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Error', error: error.message });
        }
    },

    acceptBookingOffer: async (req, res) => {
        try {
            const offer = await BookingOffer.findById(req.params.offerId).populate('booking');
            if (!offer || offer.booking.user.toString() !== req.user.id.toString()) return res.status(404).json({ success: false, message: 'Offer not found' });
            if (offer.booking.status !== 0 || offer.booking.deletedAt) return res.status(400).json({ success: false, message: 'Booking no longer available' });
            if (offer.status !== 0) return res.status(400).json({ success: false, message: 'Offer already processed' });

            const approvalMinutes = Number(process.env.PROVIDER_APPROVAL_WINDOW_MINUTES || 10);
            offer.status = 1; // 1 = Accepted by User
            offer.userAcceptedAt = new Date();
            offer.providerApprovalExpiresAt = new Date(Date.now() + approvalMinutes * 60 * 1000);
            await offer.save();

            return res.status(200).json({ success: true, message: 'Offer accepted. Awaiting provider confirmation.' });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Error', error: error.message });
        }
    },

    rejectBookingOffer: async (req, res) => {
        try {
            const offer = await BookingOffer.findById(req.params.offerId).populate('booking');
            if (!offer || offer.booking.user.toString() !== req.user.id.toString()) return res.status(404).json({ success: false, message: 'Offer not found' });
            if (offer.status !== 0 && offer.status !== 1) return res.status(400).json({ success: false, message: 'Offer cannot be rejected at this stage' });

            offer.status = 2; // 2 = Rejected by User
            if (req.body.rejectionReason) offer.rejectionReason = req.body.rejectionReason;
            await offer.save();

            return res.status(200).json({ success: true, message: 'Offer rejected' });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Error', error: error.message });
        }
    },

    approveBookingOffer: async (req, res) => {
        try {
            const offer = await BookingOffer.findById(req.params.offerId).populate('booking');
            if (!offer || offer.provider.toString() !== req.user.id.toString()) return res.status(404).json({ success: false, message: 'Offer not found' });

            const booking = offer.booking;
            if (booking.status !== 0 || booking.deletedAt) return res.status(400).json({ success: false, message: 'Booking no longer available' });
            if (offer.status !== 1) return res.status(400).json({ success: false, message: 'Offer not waiting for approval' });

            if (offer.providerApprovalExpiresAt && offer.providerApprovalExpiresAt < new Date()) {
                offer.status = 5; // 5 = Timeout
                await offer.save();
                return res.status(400).json({ success: false, message: 'Approval window expired' });
            }

            const provider = await User.findById(req.user.id);
            if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

            // Ensure distance is saved
            const providerProfile = await ProviderProfile.findOne({ user: req.user.id });
            const [pLng, pLat] = providerProfile.location.coordinates;
            const [bLng, bLat] = booking.location.coordinates;
            const distanceKm = calculateDistance(bLat, bLng, pLat, pLng);
            offer.distanceKm = Number(distanceKm.toFixed(2));

            // ========================================================
            // FREE BOOKING LOGIC
            // ========================================================
            if (Number(provider.bookingCredits || 0) > 0) {
                // Atomic booking claim to prevent race conditions
                const claimedBooking = await Booking.findOneAndUpdate(
                    { _id: booking._id, status: 0, isActive: true, provider: null, deletedAt: null },
                    { $set: { provider: req.user.id, status: 1, providerAcceptedAt: new Date() } },
                    { new: true }
                );

                if (!claimedBooking) {
                    return res.status(409).json({ success: false, message: 'Another provider has already been assigned this booking' });
                }

                const creditUsed = await useBookingCredit({ providerId: req.user.id, bookingId: booking._id });

                if (!creditUsed) {
                    await Booking.findByIdAndUpdate(booking._id, { $set: { provider: null, status: 0, providerAcceptedAt: null } });
                    return res.status(403).json({ success: false, message: 'Booking credit could not be used' });
                }

                offer.accessType = 'FREE_CREDIT';
                offer.accessFee = 0;
                offer.paymentStatus = 'NOT_REQUIRED';
                offer.providerApprovedAt = new Date();
                offer.status = 3; // 3 = Accepted by Provider
                await offer.save();

                // ----------------------------------------------------
                // REFERRAL REWARD LOGIC
                // (Rewards the person who referred THIS provider)
                // ----------------------------------------------------
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

                // Reject other pending offers since this one won
                await BookingOffer.updateMany(
                    { booking: booking._id, _id: { $ne: offer._id }, status: { $in: [0, 1] } },
                    { $set: { status: 2, rejectionReason: 'Another provider was assigned to this job' } }
                );

                // ----------------------------------------------------
                // CALCULATE PROVIDER STATS (Credits & Referrals)
                // ----------------------------------------------------
                const updatedProvider = await User.findById(req.user.id);
                const creditsLeft = Number(updatedProvider.bookingCredits || 0);
                const creditsTotal = Number(updatedProvider.bookingCreditsTotal || 0);
                const creditsUsed = Math.max(0, creditsTotal - creditsLeft);

                // Count referrals sent BY this provider that are still pending
                const pendingReferrals = await Referral.countDocuments({ referrer: req.user.id, status: 'PENDING' });

                return res.status(200).json({
                    success: true,
                    message: 'Booking confirmed successfully using free booking credit!',
                    data: {
                        creditsLeft,
                        creditsUsed,
                        pendingReferrals
                    }
                });
            }

            // ========================================================
            // PAID BOOKING LOGIC
            // ========================================================
            const baseFee = Number(process.env.BOOKING_FEE_BASE || 20);
            const perKmFee = Number(process.env.BOOKING_FEE_PER_KM || 5);
            const accessFee = Number((baseFee + Number(distanceKm) * perKmFee).toFixed(2));

            offer.accessType = 'PAID';
            offer.accessFee = accessFee;
            offer.paymentStatus = 'PENDING';
            // Status remains 1 (Accepted by User) until payment succeeds!
            await offer.save();

            // Calculate stats to show on the payment screen as well
            const creditsTotal = Number(provider.bookingCreditsTotal || 0);
            const pendingReferrals = await Referral.countDocuments({ referrer: req.user.id, status: 'PENDING' });

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
                    stats: {
                        creditsLeft: 0,
                        creditsUsed: creditsTotal,
                        pendingReferrals
                    }
                },
            });

        } catch (error) {
            console.error('Approve Booking Offer Error:', error);
            return res.status(500).json({ success: false, message: 'Error', error: error.message });
        }
    },

    cancelBookingOffer: async (req, res) => {
        try {
            const offer = await BookingOffer.findById(req.params.offerId);
            if (!offer || offer.provider.toString() !== req.user.id.toString()) return res.status(404).json({ success: false, message: 'Offer not found' });
            if (offer.status !== 1) return res.status(400).json({ success: false, message: 'Can only cancel if user has accepted' });

            offer.status = 4; // 4 = Rejected by Provider
            await offer.save();

            return res.status(200).json({ success: true, message: 'Offer cancelled by provider' });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Error', error: error.message });
        }
    },

    getOffers: async (req, res) => {
        try {
            const { bookingId } = req.query;
            const role = Number(req.user.role);
            let query = {};

            if (role === 0) {
                // User sees offers for their bookings
                const userBookings = await Booking.find({ user: req.user.id }).distinct('_id');
                query.booking = bookingId ? bookingId : { $in: userBookings };
            } else {
                // Provider sees their own offers
                query.provider = req.user.id;
                if (bookingId) query.booking = bookingId;
            }

            // 1. Fetch offers
            let offers = await BookingOffer.find(query)
                .populate({
                    path: 'booking',
                    // 1. 'select' line ko poori tarah hata diya taaki FULL DETAILS jayein (images, description, etc.)
                    populate: [
                        { path: 'service', select: 'name image' },
                        { path: 'user', select: 'firstName lastName profileImage' } // 2. Customer ki photo aur naam bhi attach kar diya
                    ]
                })
                .populate('provider', 'firstName lastName profileImage')
                .sort({ createdAt: -1 })
                .lean(); // <--- lean() is important here

            // 2. Extract Provider IDs
            const providerIds = [...new Set(offers.map(offer => offer.provider?._id?.toString()).filter(Boolean))];

            // 3. Fetch Provider Profiles in ONE query
            const profiles = await ProviderProfile.find({ user: { $in: providerIds } }).select('user location').lean();

            // 4. Create a quick Map
            const locationMap = {};
            profiles.forEach(profile => {
                locationMap[profile.user.toString()] = profile.location;
            });

            // 5. Inject location into provider object
            offers = offers.map(offer => {
                if (offer.provider && offer.provider._id) {
                    offer.provider.location = locationMap[offer.provider._id.toString()] || null;
                }
                return offer;
            });

            return res.status(200).json({ success: true, count: offers.length, data: offers });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Error', error: error.message });
        }
    },
// ============================================================
    // UNIFIED: GET MY BOOKINGS (USER & PROVIDER)
    // ============================================================
    getMyBookings: async (req, res) => {
        try {
            const { type } = req.query;
            const userId = req.user.id;
            const role = Number(req.user.role);

            let query = { deletedAt: null };
            
            let pendingOffersBookingIds = [];
            let providerOffers = [];

            // ========================================================
            // 1. QUERY BUILDER
            // ========================================================
            if (role === 0) {
                // ---------------- CUSTOMER (USER) ----------------
                query.user = userId;

                // Bookings where user has ALREADY ACCEPTED an offer (Status = 1)
                const acceptedOffers = await BookingOffer.find({
                    booking: { $in: await Booking.find({ user: userId }).distinct('_id') },
                    status: 1 
                }).distinct('booking');
                const acceptedBookingIds = acceptedOffers.map(id => id.toString());

                // Bookings where providers have SENT offers but NOT YET accepted (Status = 0)
                const pendingOffers = await BookingOffer.find({
                    booking: { $in: await Booking.find({ user: userId }).distinct('_id') },
                    status: 0 
                }).distinct('booking');
                pendingOffersBookingIds = pendingOffers.map(id => id.toString());

                if (type === '0') {
                    // Type 0: Open requests (No offers, OR only rejected offers, OR pending offers exist)
                    query.status = 0;
                    if (acceptedBookingIds.length > 0) query._id = { $nin: acceptedBookingIds };
                }
                else if (type === '1') {
                    // Type 1: User Accepted an offer, waiting for Provider's final approval
                    query.status = 0;
                    query._id = { $in: acceptedBookingIds };
                }
                else if (type === '2') {
                    // Type 2: Confirmed / Provider Approved
                    query.status = 1;
                }
            }
            else if (role === 1) {
                // ---------------- PROVIDER ----------------
                providerOffers = await BookingOffer.find({ provider: userId }).lean();
                
                // Filter ACTIVE offers only (0: Pending, 1: User Accepted, 3: Finalized)
                // Rejected (2) or Cancelled (4) are ignored here!
                const myActiveOfferBookingIds = providerOffers
                    .filter(o => [0, 1, 3].includes(o.status))
                    .map(o => o.booking.toString());

                if (type === '0') {
                    // Type 0: Open Requests. (If provider's offer was REJECTED, it SHOWS UP HERE again to resubmit!)
                    query.notifiedProviders = userId;
                    query.status = 0;
                    if (myActiveOfferBookingIds.length > 0) query._id = { $nin: myActiveOfferBookingIds };
                }
                else if (type === '1') {
                    // Type 1: Active Offer sent (Only Pending 0 or User Accepted 1)
                    const activePendingBookingIds = providerOffers
                        .filter(o => [0, 1].includes(o.status)) 
                        .map(o => o.booking.toString());
                    query._id = { $in: activePendingBookingIds };
                    query.status = 0;
                }
                else if (type === '2') {
                    // Type 2: Confirmed
                    query.provider = userId;
                    query.status = 1;
                }
            } else {
                return res.status(403).json({ success: false, message: 'Invalid role' });
            }

            // ========================================================
            // 2. FETCH BOOKINGS
            // ========================================================
            let bookings = await Booking.find(query)
                .populate('service', 'name image')
                .populate('provider', 'firstName lastName mobile email profileImage')
                .populate('user', 'firstName lastName mobile email profileImage')
                .sort({ createdAt: -1 })
                .lean();

            // ========================================================
            // 3. INJECT NEW STATUS & DISTANCE
            // ========================================================
            if (role === 0) {
                // --- CUSTOMER SIDE ---
                bookings = bookings.map(booking => {
                    booking.distanceKm = null;

                    // newStatus: 1 if there's a fresh Pending Offer waiting for User action
                    booking.newStatus = pendingOffersBookingIds.includes(booking._id.toString()) ? 1 : 0;
                    
                    // 👉 ADDED: offerId as null for User
                    booking.offerId = null;

                    return booking;
                });

            } else if (role === 1) {
                // --- PROVIDER SIDE ---
                const providerProfile = await ProviderProfile.findOne({ user: userId });

                bookings = bookings.map(booking => {
                    let distanceKm = null;
                    if (providerProfile?.location?.coordinates && booking.location?.coordinates) {
                        const [pLng, pLat] = providerProfile.location.coordinates;
                        const [bLng, bLat] = booking.location.coordinates;
                        distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
                    }
                    booking.distanceKm = distanceKm;

                    const myOffer = providerOffers.find(o => o.booking.toString() === booking._id.toString());
                    
                    // 👉 ADDED: inject offerId for Provider
                    booking.offerId = myOffer ? myOffer._id : null;
                    
                    if (type === '0') {
                        // Type 0: If there is an offer and it's Rejected (2), set newStatus = 1 (Means: "Your offer was rejected, you can bid again")
                        booking.newStatus = (myOffer && myOffer.status === 2) ? 1 : 0;
                    } else if (type === '1') {
                        // Type 1: If User Accepted (1), set newStatus = 1 (Means: "User accepted! Pay now")
                        booking.newStatus = (myOffer && myOffer.status === 1) ? 1 : 0;
                    } else {
                        booking.newStatus = 0;
                    }

                    return booking;
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Bookings fetched successfully',
                type: type || 'all',
                count: bookings.length,
                data: bookings,
            });
        } catch (error) {
            console.error('Get My Bookings Error:', error);
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },
    // ============================================================
    // BOOKING DETAILS (UNIFIED FOR USER & PROVIDER)
    // ============================================================
    getBookingDetails: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.user.id.toString();
            const role = Number(req.user.role);

            let booking = await Booking.findById(id)
                .populate('user', 'firstName lastName mobile email profileImage')
                .populate('provider', 'firstName lastName mobile email profileImage')
                .populate('service', 'name image')
                .lean();

            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

            let hasAccess = false;

            if (role === 0) {
                hasAccess = booking.user && booking.user._id.toString() === userId;
                booking.distanceKm = null;
            } else if (role === 1) {
                const isAssigned = booking.provider && booking.provider._id.toString() === userId;
                const isNotified = booking.notifiedProviders && booking.notifiedProviders.some(pId => pId.toString() === userId);
                hasAccess = isAssigned || isNotified;

                if (hasAccess) {
                    const providerProfile = await ProviderProfile.findOne({ user: userId });
                    let distanceKm = null;

                    if (providerProfile && providerProfile.location && providerProfile.location.coordinates &&
                        booking.location && booking.location.coordinates) {

                        const [pLng, pLat] = providerProfile.location.coordinates;
                        const [bLng, bLat] = booking.location.coordinates;

                        distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));

                        // --- DEBUG LOGS ---
                        console.log('\n=============================================');
                        console.log('📍 [API: Booking Details] DISTANCE CHECK');
                        console.log(`Booking ID: ${booking._id}`);
                        console.log(`   - Provider [Lng, Lat]: [${pLng}, ${pLat}]`);
                        console.log(`   - Booking  [Lng, Lat]: [${bLng}, ${bLat}]`);
                        console.log(`   - Calculated Distance: ${distanceKm} km`);
                        console.log('=============================================\n');
                    }

                    booking.distanceKm = distanceKm;
                }
            }

            if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized' });

            return res.status(200).json({ success: true, data: booking });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },
};