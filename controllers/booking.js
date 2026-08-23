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
// NOTIFY MATCHING PROVIDERS (WITH DETAILED LOGS)
// ============================================================
const notifyMatchingProviders = async (booking, isUpdate = false) => {
    try {
        console.log('\n=============================================');
        console.log('🛎️  STARTING PROVIDER MATCHING PROCESS');
        console.log(`Booking ID: ${booking._id}`);

        const serviceId = booking.service?._id ? booking.service._id : booking.service;
        const service = await Service.findById(serviceId);

        if (!service) {
            console.log('❌ Service not found in database. Exiting.');
            return;
        }

        // 0 = PENDING (Looking for providers)
        if (booking.status !== 0 || !booking.isActive || booking.deletedAt) {
            console.log(`❌ Booking is not active/pending. (status: ${booking.status}, isActive: ${booking.isActive}, deletedAt: ${booking.deletedAt}). Exiting.`);
            return;
        }

        if (!booking.location || !Array.isArray(booking.location.coordinates) || booking.location.coordinates.length !== 2) {
            console.log('❌ Booking lacks valid location coordinates. Exiting.');
            return;
        }

        const [bookingLng, bookingLat] = booking.location.coordinates;
        console.log(`📍 BOOKING LOCATION: [Lat: ${bookingLat}, Lng: ${bookingLng}]`);
        console.log(`🛠️  REQUESTED SERVICE: ${service.name} (${service._id})`);

        // Find all profiles offering this service
        const providerProfiles = await ProviderProfile.find({
            services: new mongoose.Types.ObjectId(serviceId),
        }).populate('user', 'firstName lastName email mobile role isActive');

        console.log(`🔍 Found ${providerProfiles.length} provider(s) globally offering '${service.name}'.`);

        const currentProviderIds = [];
        const providerDistances = new Map();

        for (const profile of providerProfiles) {
            console.log('\n---------------------------------------------');

            if (!profile.user) {
                console.log(`⏩ Skipping Profile ID (${profile._id}): Linked user account does not exist.`);
                continue;
            }

            console.log(`👨‍🔧 Evaluating Provider: ${profile.user.firstName} ${profile.user.lastName} (User ID: ${profile.user._id})`);

            if (!profile.user.isActive) {
                console.log(`   ❌ REJECTED: Provider user account is deactivated.`);
                continue;
            }

            const providerId = profile.user._id.toString();
            const customerId = booking.user?._id ? booking.user._id.toString() : booking.user.toString();

            if (providerId === customerId) {
                console.log(`   ❌ REJECTED: Provider is the creator of this booking (Customer cannot match their own booking).`);
                continue;
            }

            if (!profile.location || !Array.isArray(profile.location.coordinates) || profile.location.coordinates.length !== 2) {
                console.log(`   ❌ REJECTED: Provider has no location coordinates configured in Work Details.`);
                continue;
            }

            const [providerLng, providerLat] = profile.location.coordinates;
            const providerRadius = Number(profile.radius || 0);

            console.log(`   - Provider Location: [Lat: ${providerLat}, Lng: ${providerLng}]`);
            console.log(`   - Provider Service Radius: ${providerRadius} km`);

            // Check if coordinates are unconfigured default [0, 0]
            if (providerLng === 0 && providerLat === 0) {
                console.log(`   ❌ REJECTED: Provider coordinates are still set to default [0, 0]. Update Work Details location.`);
                continue;
            }

            const distance = calculateDistance(bookingLat, bookingLng, providerLat, providerLng);
            console.log(`   - Calculated Distance: ${distance.toFixed(2)} km`);

            if (!Number.isFinite(providerRadius) || providerRadius <= 0) {
                console.log(`   ❌ REJECTED: Provider radius is invalid (${providerRadius}).`);
                continue;
            }

            if (distance > providerRadius) {
                const difference = (distance - providerRadius).toFixed(2);
                console.log(`   ❌ REJECTED: Out of range. (Exceeds radius by ${difference} km)`);
                continue;
            }

            console.log(`   ✅ MATCHED: Provider is eligible and within service range!`);
            currentProviderIds.push(providerId);
            providerDistances.set(providerId, distance);
        }

        console.log('\n=============================================');
        console.log(`📋 MATCHING SUMMARY: ${currentProviderIds.length} Eligible Provider(s) Found`);
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
                    message: `Someone is looking for ${service.name} approximately ${Number(distance).toFixed(1)} km from you.`,
                    bookingId: booking._id,
                    serviceId: service._id,
                    distanceInKm: distance,
                    data: { bookingId: String(booking._id), distance: String(distance) },
                });
            } catch (error) {
                console.error(`Notification Error for Provider ${providerId}:`, error.message);
            }
        }

        if (isUpdate) {
            for (const providerId of existingProviderIds) {
                try {
                    await notifyUser({
                        userId: providerId,
                        type: 'BOOKING_UPDATED',
                        title: 'Booking Updated',
                        message: `The ${service.name} service request has been updated.`,
                        bookingId: booking._id,
                    });
                } catch (error) { }
            }
            for (const providerId of removedProviderIds) {
                try {
                    await notifyUser({
                        userId: providerId,
                        type: 'BOOKING_UNAVAILABLE',
                        title: 'Booking No Longer Available',
                        message: `The ${service.name} request is no longer available in your radius.`,
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

const notifyExistingProvidersUnavailable = async (booking) => {
    try {
        const serviceId = booking.service?._id ? booking.service._id : booking.service;
        const service = await Service.findById(serviceId);
        if (!service) return;

        const providerIds = (booking.notifiedProviders || []).map((id) => id.toString());
        for (const providerId of providerIds) {
            try {
                await notifyUser({
                    userId: providerId,
                    type: 'BOOKING_UNAVAILABLE',
                    title: 'Booking No Longer Available',
                    message: `The ${service.name} request has been cancelled or assigned.`,
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

            if (req.body.description) booking.description = req.body.description;
            if (req.body.address) booking.address = req.body.address;

            await booking.save();
            await notifyMatchingProviders(booking, true);

            return res.status(200).json({
                success: true,
                message: 'Your request has been updated and sent to nearby service providers. You can view details in My Bookings.'
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    deleteBooking: async (req, res) => {
        try {
            const booking = await Booking.findOne({ _id: req.params.id, user: req.user.id });
            if (!booking || booking.deletedAt) return res.status(404).json({ success: false, message: 'Booking not found' });

            // Allow deletion unless the booking is already completed
            if (booking.status === 2) return res.status(400).json({ success: false, message: 'Completed bookings cannot be deleted or cancelled' });

            const previousStatus = booking.status;
            const assignedProvider = booking.provider;

            // Soft Delete the booking
            booking.isActive = false;
            booking.deletedAt = new Date();
            await booking.save();

            // If the booking was already ASSIGNED (Status 1), notify that specific provider
            if (previousStatus === 1 && assignedProvider) {
                try {
                    await notifyUser({
                        userId: assignedProvider,
                        type: 'BOOKING_CANCELLED_BY_USER',
                        title: 'Booking Cancelled',
                        message: 'The customer has cancelled the booking after it was assigned to you.',
                        bookingId: booking._id,
                    });

                    // Mark their accepted offer as rejected/cancelled
                    await BookingOffer.findOneAndUpdate(
                        { booking: booking._id, provider: assignedProvider, status: 3 },
                        { $set: { status: 2, rejectionReason: 'Customer cancelled the booking after assignment' } }
                    );
                } catch (error) {
                    console.log("Failed to notify provider of cancellation");
                }
            } else {
                // If it was still pending, notify all nearby providers that it's gone
                await notifyExistingProvidersUnavailable(booking);
            }

            return res.status(200).json({ success: true, message: 'Booking cancelled successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    // ============================================================
    // OFFERS MANAGEMENT
    // ============================================================

    createBookingOffer: async (req, res) => {
        try {
            const { id } = req.params;
            const amount = Number(req.body.offerAmount);
            const proposedDate = req.body.proposedDate; // Extract from body
            const proposedTime = req.body.proposedTime; // Extract from body

            if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ success: false, message: 'Valid offerAmount is required' });

            const booking = await Booking.findOne({ _id: id, isActive: true, status: 0, deletedAt: null }).populate('service', 'name');
            if (!booking) return res.status(404).json({ success: false, message: 'Booking not available' });

            const isProviderNotified = booking.notifiedProviders.some(pId => pId.toString() === req.user.id.toString());
            if (!isProviderNotified) return res.status(403).json({ success: false, message: 'You are not eligible for this booking' });

            const existingOffer = await BookingOffer.findOne({ booking: booking._id, provider: req.user.id });
            if (existingOffer) return res.status(400).json({ success: false, message: 'Offer already submitted' });

            const providerProfile = await ProviderProfile.findOne({ user: req.user.id });
            const [pLng, pLat] = providerProfile.location.coordinates;
            const [bLng, bLat] = booking.location.coordinates;
            const distanceKm = calculateDistance(bLat, bLng, pLat, pLng);

            const offer = await BookingOffer.create({
                booking: booking._id,
                provider: req.user.id,
                offerAmount: amount,
                proposedDate: proposedDate ? String(proposedDate).trim() : null, // Save DateTime string here
                proposedTime: proposedTime ? String(proposedTime).trim() : null, // Save DateTime string here
                distanceKm: Number(distanceKm.toFixed(2)),
                status: 0, // 0 = Pending
            });

            return res.status(201).json({ success: true, message: 'Offer submitted' });
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
                    select: 'user service status address location deletedAt',
                    populate: { path: 'service', select: 'name image' }
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

            let query = { deletedAt: null }; // Default to active bookings

            if (role === 0) {
                // ====================================================
                // CUSTOMER LOGIC
                // ====================================================
                query.user = userId;

                if (type === '0') {
                    // TYPE 0: Pending bookings with NO OFFERS yet
                    const offeredBookingIds = await BookingOffer.find({
                        booking: { $in: await Booking.find({ user: userId }).distinct('_id') },
                        status: { $in: [0, 1] } // Has active offers
                    }).distinct('booking');

                    query.status = 0;
                    if (offeredBookingIds.length > 0) {
                        query._id = { $nin: offeredBookingIds }; // Exclude bookings that have offers
                    }

                } else if (type === '1') {
                    // TYPE 1: Pending bookings WITH OFFERS
                    const offeredBookingIds = await BookingOffer.find({
                        booking: { $in: await Booking.find({ user: userId }).distinct('_id') },
                        status: { $in: [0, 1] } // Has active offers
                    }).distinct('booking');

                    query.status = 0;
                    query._id = { $in: offeredBookingIds }; // ONLY include bookings that have offers

                } else if (type === '2') {
                    // TYPE 2: Confirmed / Assigned Bookings
                    // (Provider final approval done)
                    query.status = { $in: [1, 2] };

                } else if (type === '3') {
                    // TYPE 3: Soft Deleted / Cancelled Bookings
                    delete query.deletedAt;
                    query.deletedAt = { $ne: null };
                }

            } else if (role === 1) {
                // ====================================================
                // PROVIDER LOGIC
                // ====================================================
                if (type === '0') {
                    // TYPE 0: Pending / New Leads (Notified, but NO offer sent yet)
                    const myOffers = await BookingOffer.find({ provider: userId }).distinct('booking');
                    query.notifiedProviders = userId;
                    query.status = 0;
                    if (myOffers.length > 0) {
                        query._id = { $nin: myOffers };
                    }
                } else if (type === '1') {
                    // TYPE 1: Bookings the provider has sent an offer for
                    const myOffers = await BookingOffer.find({ provider: userId }).distinct('booking');
                    query._id = { $in: myOffers };
                } else if (type === '2') {
                    // TYPE 2: Confirmed / Assigned to Provider
                    query.provider = userId;
                    query.status = { $in: [1, 2] };
                } else if (type === '3') {
                    // TYPE 3: Rejected / Cancelled / Timeout Offers
                    const rejectedOffers = await BookingOffer.find({ 
                        provider: userId, 
                        status: { $in: [2, 4, 5] } 
                    }).distinct('booking');
                    query._id = { $in: rejectedOffers };
                } else {
                    // Default All for Provider
                    query.$or = [
                        { notifiedProviders: userId, status: 0 },
                        { provider: userId }
                    ];
                }
            } else {
                return res.status(403).json({ success: false, message: 'Invalid role' });
            }

            // Execute the query
            let bookings = await Booking.find(query)
                .populate('service', 'name image')
                .populate('provider', 'firstName lastName mobile email profileImage')
                .populate('user', 'firstName lastName mobile email profileImage')
                .sort({ createdAt: -1 })
                .lean();

            // Inject dynamic distance property for Providers
            if (role === 1) {
                const profile = await ProviderProfile.findOne({ user: userId });
                if (profile && profile.location && profile.location.coordinates) {
                    const [pLng, pLat] = profile.location.coordinates;
                    bookings = bookings.map(b => {
                        if (b.location && b.location.coordinates) {
                            const [bLng, bLat] = b.location.coordinates;
                            b.distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
                        }
                        return b;
                    });
                }
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
            } else if (role === 1) {
                const isAssigned = booking.provider && booking.provider._id.toString() === userId;
                const isNotified = booking.notifiedProviders && booking.notifiedProviders.some(pId => pId.toString() === userId);
                hasAccess = isAssigned || isNotified;

                if (hasAccess) {
                    const profile = await ProviderProfile.findOne({ user: userId });
                    if (profile && profile.location && profile.location.coordinates) {
                        const [pLng, pLat] = profile.location.coordinates;
                        const [bLng, bLat] = booking.location.coordinates;
                        booking.distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
                    }
                }
            }

            if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized' });

            return res.status(200).json({ success: true, data: booking });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },
};