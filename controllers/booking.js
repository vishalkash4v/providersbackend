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
const Kyc = require('../models/Kyc');


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
            // 👇 NAYA CODE: Agar provider ne booking hide/remove ki hai, toh usko ignore karo 👇
            const ignoredIds = (booking.ignoredProviders || []).map(id => id.toString());
            if (ignoredIds.includes(providerId)) continue;
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
            console.log('Booking Creation Request:', req.body);

            const { service: serviceId, description, materialRequired, materialOption, latitude, longitude, address, visitPreference, preferredDates, preferredTimeStart, preferredTimeEnd } = req.body;
            const userId = req.user.id;

            if (Number(req.user.role) !== 0) return res.status(403).json({ success: false, message: 'Only customers can create bookings' });

            const service = await Service.findOne({ _id: serviceId, isActive: true });
            if (!service) return res.status(400).json({ success: false, message: 'Invalid service' });

            const lat = Number(latitude);
            const lng = Number(longitude);

            const materialRequiredValue =
                materialRequired === true ||
                materialRequired === 'true';

            const booking = await Booking.create({
                user: userId,
                service: serviceId,
                provider: null,
                workImages: normalizeImagePaths(req.body.images),
                description: description ? description.trim() : '',
                materialRequired: materialRequiredValue,
                materialOption: materialOption || "",
                location: { type: 'Point', coordinates: [lng, lat] },
                address: address ? address.trim() : '',
                visitPreference: visitPreference || 'immediate',
                status: 0, // 0 = Pending
                isActive: true,
                deletedAt: null,
                notifiedProviders: [],
            });

            // 👇 FETCH KYC FOR NOTIFICATION & RESPONSE 👇
            const kycData = await Kyc.findOne({ user: userId }).select('status rejectionReason').lean();
            const kycStatus = kycData ? kycData.status : 0;
            const rejectionReason = kycData?.rejectionReason || null;

            // Attach directly to booking object so `notifyMatchingProviders` can access it
            booking.kycStatus = kycStatus;
            booking.rejectionReason = rejectionReason;
            // 👆 ====================================== 👆

            await notifyMatchingProviders(booking, false);

            return res.status(201).json({
                success: true,
                message: 'Your request has been sent to nearby service providers. You can view details in My Bookings.',
                kycVerification: {
                    status: kycStatus,
                    rejectionReason: rejectionReason,
                    isVerified: kycStatus === 2
                }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    updateBooking: async (req, res) => {
        try {
            const booking = await Booking.findOne({
                _id: req.params.id,
                user: req.user.id
            });

            if (!booking || booking.deletedAt) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found'
                });
            }

            if (booking.status !== 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Booking can only be updated while pending'
                });
            }

            let updateMessage = 'The service request details have been updated by the customer.';

            // -------------------------
            // Location / Address
            // -------------------------
            if (
                req.body.latitude !== undefined ||
                req.body.longitude !== undefined ||
                req.body.address !== undefined
            ) {
                updateMessage = 'The location/address for the service request has been changed.';

                if (
                    req.body.latitude !== undefined &&
                    req.body.longitude !== undefined
                ) {
                    booking.location = {
                        type: 'Point',
                        coordinates: [
                            Number(req.body.longitude),
                            Number(req.body.latitude)
                        ]
                    };
                }

                if (req.body.address !== undefined) {
                    booking.address = req.body.address;
                }
            }

            // -------------------------
            // Date / Time
            // -------------------------
            if (
                req.body.preferredDates !== undefined ||
                req.body.preferredTimeStart !== undefined ||
                req.body.preferredTimeEnd !== undefined
            ) {
                updateMessage = 'The preferred date and time for the service request has been changed.';

                if (req.body.preferredDates !== undefined) {
                    booking.preferredDates = req.body.preferredDates;
                }

                if (req.body.preferredTimeStart !== undefined) {
                    booking.preferredTimeStart = req.body.preferredTimeStart;
                }

                if (req.body.preferredTimeEnd !== undefined) {
                    booking.preferredTimeEnd = req.body.preferredTimeEnd;
                }
            }

            // -------------------------
            // Description / Materials
            // -------------------------
            if (
                req.body.description !== undefined ||
                req.body.materialRequired !== undefined ||
                req.body.materialOption !== undefined
            ) {
                updateMessage = 'The description or material requirements for the service request have been updated.';

                if (req.body.description !== undefined) {
                    booking.description = req.body.description;
                }

                if (req.body.materialRequired !== undefined) {
                    booking.materialRequired =
                        req.body.materialRequired === true ||
                        req.body.materialRequired === 'true';
                }

                if (req.body.materialOption !== undefined) {
                    booking.materialOption = req.body.materialOption;
                }
            }

            await booking.save();

            // 👇 FETCH KYC FOR NOTIFICATION & RESPONSE 👇
            const kycData = await Kyc.findOne({ user: req.user.id }).select('status rejectionReason').lean();
            const kycStatus = kycData ? kycData.status : 0;
            const rejectionReason = kycData?.rejectionReason || null;

            // Attach directly to booking object so `notifyMatchingProviders` can access it
            booking.kycStatus = kycStatus;
            booking.rejectionReason = rejectionReason;
            // 👆 ====================================== 👆

            await notifyMatchingProviders(
                booking,
                true,
                updateMessage
            );

            return res.status(200).json({
                success: true,
                message: 'Your request has been updated and nearby providers have been notified.',
                kycVerification: {
                    status: kycStatus,
                    rejectionReason: rejectionReason,
                    isVerified: kycStatus === 2
                }
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message
            });
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

                    // 👇 NAYA CODE: Resubmit hone par customer ko notification bhejo 👇
                    try {
                        await notifyUser({
                            userId: booking.user._id || booking.user, 
                            type: 'NEW_OFFER_RECEIVED',
                            title: 'Offer Resubmitted! 🔄',
                            message: `A provider has sent a revised offer of ₹${amount} for your service request.`,
                            bookingId: booking._id,
                            data: {
                                offerId: offer._id
                            }
                        });
                    } catch (notifyErr) {
                        console.error('Notification failed on resubmit:', notifyErr);
                    }
                    // 👆 ======================================================= 👆

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

            // Provider ne offer bheja, Customer ko batao
            await notifyUser({
                userId: booking.user,
                type: 'NEW_OFFER_RECEIVED',
                title: 'New Offer Received! 💰',
                message: `A provider has sent an offer of ₹${amount} for your service request.`,
                bookingId: booking._id,

                data: {
                    offerId: offer._id
                }
            });

            return res.status(201).json({ success: true, message: 'Offer submitted', data: offer });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Error', error: error.message });
        }
    },
    acceptBookingOffer: async (req, res) => {
        try {
            const offer = await BookingOffer
                .findById(req.params.offerId)
                .populate('booking');

            if (
                !offer ||
                offer.booking.user.toString() !== req.user.id.toString()
            ) {
                return res.status(404).json({
                    success: false,
                    message: 'Offer not found'
                });
            }

            if (offer.booking.status !== 0 || offer.booking.deletedAt) {
                return res.status(400).json({
                    success: false,
                    message: 'Booking no longer available'
                });
            }

            if (offer.status !== 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Offer already processed'
                });
            }

            const approvalMinutes = Number(
                process.env.PROVIDER_APPROVAL_WINDOW_MINUTES || 10
            );

            offer.status = 1; // 1 = Accepted by User
            offer.userAcceptedAt = new Date();

            offer.providerApprovalExpiresAt = new Date(
                Date.now() + approvalMinutes * 60 * 1000
            );

            await offer.save();

            // Customer ne accept kiya, Provider ko batao
            await notifyUser({
                userId: offer.provider,
                type: 'OFFER_ACCEPTED',
                title: 'Offer Accepted! 🎉',
                message: 'The customer has accepted your offer! Open the app to finalize the booking.',
                bookingId: offer.booking._id,

                data: {
                    offerId: offer._id,
                    providerApprovalExpiresAt: offer.providerApprovalExpiresAt.toISOString()
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Offer accepted. Awaiting provider confirmation.'
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Error',
                error: error.message
            });
        }
    },

    rejectBookingOffer: async (req, res) => {
        try {
            const offer = await BookingOffer
                .findById(req.params.offerId)
                .populate('booking');

            if (
                !offer ||
                offer.booking.user.toString() !== req.user.id.toString()
            ) {
                return res.status(404).json({
                    success: false,
                    message: 'Offer not found'
                });
            }

            if (offer.status !== 0 && offer.status !== 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Offer cannot be rejected at this stage'
                });
            }

            offer.status = 2; // 2 = Rejected by User

            if (req.body.rejectionReason) {
                offer.rejectionReason = req.body.rejectionReason;
            }

            await offer.save();

            // Customer ne offer reject kiya, Provider ko batao
            await notifyUser({
                userId: offer.provider,
                type: 'OFFER_REJECTED',
                title: 'Offer Rejected ❌',
                message: 'The customer has rejected your offer.',
                bookingId: offer.booking._id,

                data: {
                    offerId: offer._id,
                    rejectionReason: offer.rejectionReason || ''
                }
            });

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
                // ========================================================
                // ATOMIC BOOKING CLAIM
                // ========================================================
                const claimedBooking = await Booking.findOneAndUpdate(
                    {
                        _id: booking._id,
                        status: 0, // 0 = PENDING
                        isActive: true,
                        provider: null,
                    },
                    {
                        $set: {
                            provider: req.user.id, // Fixed: changed 'payment.provider' to req.user.id for Free Booking
                            status: 1, // 1 = ASSIGNED/FINALIZED
                            providerAcceptedAt: new Date(),
                        },
                    },
                    { returnDocument: 'after' }
                );

                // Agar claim fail hua (provider: null nahi tha)
                if (!claimedBooking) {
                    const currentBooking = await Booking.findById(booking._id);

                    // Agar same usi provider ko mili hai (kisi dusri API thread ke through), toh SUCCESS maano!
                    if (currentBooking && currentBooking.provider && currentBooking.provider.toString() === req.user.id.toString()) {
                        console.log('⚡ [Race Condition Resolved] Booking already assigned to THIS provider by another thread.');

                        offer.accessType = 'FREE_CREDIT';
                        offer.paymentStatus = 'NOT_REQUIRED';
                        offer.providerApprovedAt = offer.providerApprovedAt || new Date();
                        offer.status = 3; // 3 = PROVIDER_APPROVED
                        await offer.save();

                        return { success: true, alreadyFinalized: true, booking: currentBooking, offer };
                    }

                    // Agar kisi sach mein dusre provider ko mili hai, TABHI refund/reject karo!
                    console.log('⚠️ [Free Credit] Booking lost to SOMEONE ELSE.');
                    offer.status = 2; // 2 = REJECTED
                    offer.rejectionReason = 'Lost to another provider during finalization';
                    await offer.save();

                    return res.status(409).json({ success: false, bookingAlreadyAssigned: true, message: 'Another provider has already been assigned this booking.' });
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
                        await addBookingCredits({
                            providerId: referral.referrer,
                            amount: rewardCredits,
                            type: 'REFERRAL_REWARD',
                            referral: referral._id,
                            booking: booking._id,
                            description: 'Referral reward for referred provider first approved job'
                        });

                        referral.status = 'SUCCESS';
                        referral.firstBooking = booking._id;
                        referral.successfulAt = new Date();
                        referral.rewardCredits = rewardCredits;
                        await referral.save();
                    }
                }

                // 👇 Reject other pending offers and Notify them 👇
                const losingOffersList = await BookingOffer.find({
                    booking: booking._id,
                    _id: { $ne: offer._id },
                    status: { $in: [0, 1] }
                });

                await BookingOffer.updateMany(
                    {
                        booking: booking._id,
                        _id: { $ne: offer._id },
                        status: { $in: [0, 1] }
                    },
                    {
                        $set: {
                            status: 2,
                            rejectionReason: 'Another provider was assigned to this job'
                        }
                    }
                );

                for (const losingOffer of losingOffersList) {
                    try {
                        await notifyUser({
                            userId: losingOffer.provider,
                            type: 'OFFER_REJECTED',
                            title: 'Job Assigned to Someone Else 😔',
                            message: 'The customer has assigned this job to another provider. Better luck next time!',
                            bookingId: booking._id
                        });
                    } catch (err) {
                        console.error('Failed to notify losing provider:', err);
                    }
                }
                // 👆 ========================================== 👆

                // ----------------------------------------------------
                // CALCULATE PROVIDER STATS (Credits & Referrals)
                // ----------------------------------------------------
                const updatedProvider = await User.findById(req.user.id);
                const creditsLeft = Number(updatedProvider.bookingCredits || 0);
                const creditsTotal = Number(updatedProvider.bookingCreditsTotal || 0);
                const creditsUsed = Math.max(0, creditsTotal - creditsLeft);

                // Count referrals sent BY this provider that are still pending
                const pendingReferrals = await Referral.countDocuments({
                    referrer: req.user.id,
                    status: 'PENDING'
                });

                // Provider ne final kar diya, Customer ko batao booking fix ho gayi
                await notifyUser({
                    userId: booking.user,
                    type: 'BOOKING_CONFIRMED',
                    title: 'Booking Confirmed! ✅',
                    message: `The provider has confirmed your booking and will arrive at the scheduled time.`,
                    bookingId: booking._id,
                    data: {
                        offerId: offer._id
                    }
                });

                return res.status(200).json({
                    success: true,
                    message: 'Booking confirmed successfully using free booking credit!',
                    // data: {
                    //     creditsLeft,
                    //     creditsUsed,
                    //     pendingReferrals
                    // }
                });
            }

            // ========================================================
            // PAID BOOKING LOGIC (FLAT PRICING)
            // ========================================================
            const startingKmRange = Number(process.env.STARTING_KM_RANGE || 10);
            const startingRangePrice = Number(process.env.STARTING_RANGE_PRICE || 90);
            const extraFlatPrice = Number(process.env.ABOVE_RANGE_PRICE || 40);

            let accessFee = startingRangePrice;

            // If distance exceeds the starting range, add the extra flat price once
            if (Number(distanceKm) > startingKmRange) {
                accessFee += extraFlatPrice;
            }

            offer.accessType = 'PAID';
            offer.accessFee = Number(accessFee.toFixed(2));
            offer.paymentStatus = 'PENDING';
            // Status remains 1 (Accepted by User) until payment succeeds!
            await offer.save();

            // Calculate stats to show on the payment screen as well
            const creditsTotal = Number(provider.bookingCreditsTotal || 0);
            const pendingReferrals = await Referral.countDocuments({
                referrer: req.user.id,
                status: 'PENDING'
            });

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
            return res.status(500).json({
                success: false,
                message: 'Error',
                error: error.message
            });
        }
    },

    cancelBookingOffer: async (req, res) => {
        try {
            const offer = await BookingOffer.findById(req.params.offerId);

            if (!offer || offer.provider.toString() !== req.user.id.toString()) {
                return res.status(404).json({
                    success: false,
                    message: 'Offer not found'
                });
            }

            if (offer.status !== 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Can only cancel if user has accepted'
                });
            }

            offer.status = 4; // 4 = Rejected by Provider
            await offer.save();

            await notifyUser({
                userId: offer.booking.user,
                type: 'OFFER_WITHDRAWN',
                title: 'Offer Withdrawn ❌',
                message: `A provider has withdrawn their offer for your booking.`,
                bookingId: offer.booking._id,
                data: {
                    offerId: offer._id
                }
            });

            return res.status(200).json({
                success: true,
                message: 'Offer cancelled by provider'
            });

        } catch (error) {
            return res.status(500).json({
                success: false,
                message: 'Error',
                error: error.message
            });
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

                if (bookingId) {
                    // 👉 Agar specific bookingID aayi hai, toh STATUS filter mat lagao (Sab dikhao)
                    query.booking = bookingId;
                } else {
                    // 👉 Agar general offers dekh rahe hain, toh SIRF PENDING (0) dikhao
                    query.booking = { $in: userBookings };
                    query.status = 0;
                }
            } else {
                // Provider sees their own offers
                query.provider = req.user.id;
                if (bookingId) query.booking = bookingId;
            }

            // 1. Fetch offers
            let offers = await BookingOffer.find(query)
                .populate({
                    path: 'booking',
                    populate: [
                        { path: 'service', select: 'name image' },
                        { path: 'user', select: 'firstName lastName profileImage' }
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

            // 👇 1. AUTO-EXPIRE OFFERS (TIMEOUT LOGIC) 👇
            await BookingOffer.updateMany({
                status: 1,
                providerApprovalExpiresAt: { $lt: new Date() }
            }, {
                $set: { status: 5 }
            });
            // 👆 ================================================== 👆

            // 👇 2. CANCELLED BOOKINGS HIDE (isActive: true) 👇
            let query = { deletedAt: null, isActive: true };
            // 👆 ================================================== 👆

            let pendingOffersBookingIds = [];
            let providerOffers = [];
            let providerProfileData = null;
            let creditsLeft = null;

            // ========================================================
            // 1. QUERY BUILDER
            // ========================================================
            if (role === 0) {
                // ---------------- CUSTOMER (USER) ----------------
                query.user = userId;

                const acceptedOffers = await BookingOffer.find({
                    booking: { $in: await Booking.find({ user: userId }).distinct('_id') },
                    status: 1
                }).distinct('booking');
                const acceptedBookingIds = acceptedOffers.map(id => id.toString());

                const pendingOffers = await BookingOffer.find({
                    booking: { $in: await Booking.find({ user: userId }).distinct('_id') },
                    status: 0
                }).distinct('booking');
                pendingOffersBookingIds = pendingOffers.map(id => id.toString());

                if (type === '0') {
                    query.status = 0;
                    if (acceptedBookingIds.length > 0) query._id = { $nin: acceptedBookingIds };
                }
                else if (type === '1') {
                    query.status = 0;
                    query._id = { $in: acceptedBookingIds };
                }
                else if (type === '2') {
                    query.status = 1;
                }
            }
            else if (role === 1) {
                // ---------------- PROVIDER ----------------
                providerProfileData = await ProviderProfile.findOne({ user: userId }).lean();
                const mySelectedServices = providerProfileData?.services || [];

                const providerUser = await User.findById(userId).select('bookingCredits').lean();
                creditsLeft = Math.max(0, Number(providerUser?.bookingCredits || 0));

                providerOffers = await BookingOffer.find({ provider: userId }).lean();

                const myActiveOfferBookingIds = providerOffers
                    .filter(o => [0, 1, 3].includes(o.status))
                    .map(o => o.booking.toString());

                if (type === '0') {
                    query.notifiedProviders = userId;
                    query.status = 0;

                    if (mySelectedServices.length > 0) {
                        query.service = { $in: mySelectedServices };
                    }
                    if (myActiveOfferBookingIds.length > 0) query._id = { $nin: myActiveOfferBookingIds };
                }
                else if (type === '1') {
                    const activePendingBookingIds = providerOffers
                        .filter(o => [0, 1].includes(o.status))
                        .map(o => o.booking.toString());
                    query._id = { $in: activePendingBookingIds };
                    query.status = 0;
                }
                else if (type === '2') {
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

            // Fetch Provider Locations Only For Type 2
            let providerLocationMap = {};
            if (type === '2' && bookings.length > 0) {
                const assignedProviderIds = [...new Set(bookings.map(b => b.provider?._id?.toString()).filter(Boolean))];
                if (assignedProviderIds.length > 0) {
                    const profiles = await ProviderProfile.find({ user: { $in: assignedProviderIds } }).select('user location').lean();
                    profiles.forEach(p => {
                        providerLocationMap[p.user.toString()] = p.location || null;
                    });
                }
            }

            // ========================================================
            // 3. INJECT DATA
            // ========================================================
            if (role === 0) {
                // --- CUSTOMER SIDE ---
                const bookingIdsForUser = bookings.map(b => b._id);
                const userActiveOffers = await BookingOffer.find({
                    booking: { $in: bookingIdsForUser },
                    status: { $in: [1, 3] } 
                }).lean();

                bookings = bookings.map(booking => {
                    const finalOffer = userActiveOffers.find(o => o.booking.toString() === booking._id.toString());
                    let calculatedDistance = finalOffer ? finalOffer.distanceKm : null;

                    if (type === '2' && booking.provider && booking.provider._id) {
                        const pLoc = providerLocationMap[booking.provider._id.toString()];
                        booking.provider.location = pLoc || null;

                        if (pLoc && pLoc.coordinates && booking.location && booking.location.coordinates) {
                            const [pLng, pLat] = pLoc.coordinates;
                            const [bLng, bLat] = booking.location.coordinates;
                            calculatedDistance = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
                        }
                    }

                    booking.distanceKm = calculatedDistance; 
                    booking.newStatus = pendingOffersBookingIds.includes(booking._id.toString()) ? 1 : 0;
                    booking.offerId = finalOffer ? finalOffer._id : null;
                    booking.offerAmount = finalOffer ? finalOffer.offerAmount : null;
                    booking.proposedDate = finalOffer ? finalOffer.proposedDate : null;
                    booking.proposedTime = finalOffer ? finalOffer.proposedTime : null;
                    booking.accessFee = finalOffer ? finalOffer.accessFee : null;
                    booking.offerStatus = finalOffer ? finalOffer.status : null;
                    booking.providerApprovalExpiresAt = null;
                    booking.creditsLeft = null;

                    return booking;
                });

                if (type === '0') {
                    bookings.sort((a, b) => {
                        if (b.newStatus !== a.newStatus) return b.newStatus - a.newStatus;
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    });
                }
            } else if (role === 1) {
                // --- PROVIDER SIDE ---
                bookings = bookings.map(booking => {
                    let distanceKm = null;

                    if (providerProfileData?.location?.coordinates && booking.location?.coordinates) {
                        const [pLng, pLat] = providerProfileData.location.coordinates;
                        const [bLng, bLat] = booking.location.coordinates;
                        distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
                    }
                    booking.distanceKm = distanceKm;

                    const myOffer = providerOffers.find(o => o.booking.toString() === booking._id.toString());

                    booking.offerId = myOffer ? myOffer._id : null;
                    booking.providerApprovalExpiresAt = (myOffer && myOffer.status === 1) ? myOffer.providerApprovalExpiresAt : null;
                    booking.creditsLeft = creditsLeft;
                    booking.offerAmount = myOffer ? myOffer.offerAmount : null;
                    booking.proposedDate = myOffer ? myOffer.proposedDate : null;
                    booking.proposedTime = myOffer ? myOffer.proposedTime : null;
                    booking.accessFee = myOffer ? myOffer.accessFee : null;
                    booking.offerStatus = myOffer ? myOffer.status : null;

                    if (type === '0') {
                        booking.newStatus = (myOffer && [2, 4, 5].includes(myOffer.status)) ? 1 : 0;
                    } else if (type === '1') {
                        booking.newStatus = (myOffer && myOffer.status === 1) ? 1 : 0;
                    } else {
                        booking.newStatus = 0;
                    }

                    if (type === '2' && booking.provider && booking.provider._id) {
                        booking.provider.location = providerLocationMap[booking.provider._id.toString()] || null;
                    }

                    return booking;
                });
            }

            // ========================================================
            // 4. KYC VERIFICATION STATUS (ONLY FOR TYPE 0)
            // ========================================================
            let kycVerification = undefined; // Undefined means it won't show up in type 1 or 2

            if (type === '0') {
                if (role === 0) {
                    // USER: Send nulls
                    kycVerification = {
                        status: null,
                        rejectionReason: null,
                        isVerified: false
                    };
                } else if (role === 1) {
                    // PROVIDER: Fetch from KYC collection
                    const kycData = await Kyc.findOne({ user: userId }).select('status rejectionReason').lean();
                    kycVerification = {
                        status: kycData ? kycData.status : 0, // 0: Not Submitted, 1: Submitted, 2: Approved, 3: Rejected
                        rejectionReason: kycData?.rejectionReason || null,
                        isVerified: kycData?.status === 2
                    };
                }
            }

            // ========================================================
            // 5. SEND RESPONSE
            // ========================================================
            return res.status(200).json({
                success: true,
                message: 'Bookings fetched successfully',
                type: type || 'all',
                count: bookings.length,
                kycVerification, // 👇 Appended right alongside count & data
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
    // ============================================================
    // BOOKING DETAILS (UNIFIED FOR USER & PROVIDER)
    // ============================================================
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

                // Fetch provider location for the user if a provider is assigned
                if (booking.provider && booking.provider._id) {
                    const providerProfile = await ProviderProfile.findOne({ user: booking.provider._id }).select('location').lean();
                    if (providerProfile && providerProfile.location) {
                        booking.provider.location = providerProfile.location;

                        // Calculate distance if both locations exist
                        if (providerProfile.location.coordinates && booking.location && booking.location.coordinates) {
                            const [pLng, pLat] = providerProfile.location.coordinates;
                            const [bLng, bLat] = booking.location.coordinates;
                            booking.distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
                        }
                    }
                }

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
                    }

                    booking.distanceKm = distanceKm;
                }
            }

            if (!hasAccess) return res.status(403).json({ success: false, message: 'Unauthorized' });

            // 👇 FETCH AND INJECT OFFER DETAILS 👇
            let relevantOffer = null;

            if (role === 0) {
                // Customer ke liye: Jo offer accept/approve hua hai (Status 1 ya 3), wo uthao
                relevantOffer = await BookingOffer.findOne({
                    booking: booking._id,
                    status: { $in: [1, 3] }
                }).lean();
            } else if (role === 1) {
                // Provider ke liye: Uska apna bheja hua offer uthao
                relevantOffer = await BookingOffer.findOne({
                    booking: booking._id,
                    provider: userId
                }).lean();
            }

            // In keys ko booking object mein attach kar do
            booking.offerAmount = relevantOffer ? relevantOffer.offerAmount : null;
            booking.offerId = relevantOffer ? relevantOffer._id : null;
            booking.proposedDate = relevantOffer ? relevantOffer.proposedDate : null;
            booking.proposedTime = relevantOffer ? relevantOffer.proposedTime : null;
            booking.accessFee = relevantOffer ? relevantOffer.accessFee : null;
            booking.offerStatus = relevantOffer ? relevantOffer.status : null;
            // 👆 ========================================== 👆

            return res.status(200).json({ success: true, data: booking });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },

    removeBookingRequest: async (req, res) => {
        try {
            const { id } = req.params; // Booking ID
            const userId = req.user.id;

            if (Number(req.user.role) !== 1) {
                return res.status(403).json({ success: false, message: 'Only providers can perform this action' });
            }

            const booking = await Booking.findById(id);
            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

            // 1. Remove from notifiedProviders (hides it from the New Requests list)
            booking.notifiedProviders = booking.notifiedProviders.filter(
                pId => pId.toString() !== userId.toString()
            );

            // 2. Add to ignoredProviders (prevents re-notifying on updates)
            if (!booking.ignoredProviders) booking.ignoredProviders = [];
            if (!booking.ignoredProviders.includes(userId)) {
                booking.ignoredProviders.push(userId);
            }

            await booking.save();

            return res.status(200).json({ success: true, message: 'Booking request removed from your list' });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
        }
    },


    // ============================================================
    // GET OFFER DETAILS (UNIFIED FOR USER & PROVIDER)
    // ============================================================
    getOfferDetails: async (req, res) => {
        try {
            const { id } = req.params; // Offer ID
            const userId = req.user.id.toString();
            const role = Number(req.user.role);

            // 1. Fetch Offer & Populate related data
            let offer = await BookingOffer.findById(id)
                .populate({
                    path: 'booking',
                    populate: [
                        { path: 'service', select: 'name image' },
                        { path: 'user', select: 'firstName lastName mobile email profileImage' }
                    ]
                })
                .populate('provider', 'firstName lastName mobile email profileImage')
                .lean();

            if (!offer) {
                return res.status(404).json({ success: false, message: 'Offer not found' });
            }

            // 2. Role-Based Access Validation
            let hasAccess = false;
            
            if (role === 0) {
                // Customer: Should only see offers made on their own bookings
                hasAccess = offer.booking && offer.booking.user && offer.booking.user._id.toString() === userId;
            } else if (role === 1) {
                // Provider: Should only see offers they created
                hasAccess = offer.provider && offer.provider._id.toString() === userId;
            }

            if (!hasAccess) {
                return res.status(403).json({ success: false, message: 'Unauthorized access to this offer' });
            }

            // 3. Inject Provider Location & Calculate Live Distance
            let distanceKm = offer.distanceKm || null; 

            if (offer.provider && offer.provider._id && offer.booking && offer.booking.location) {
                const providerProfile = await ProviderProfile.findOne({ user: offer.provider._id }).select('location').lean();
                
                if (providerProfile && providerProfile.location) {
                    offer.provider.location = providerProfile.location; 

                    if (providerProfile.location.coordinates && offer.booking.location.coordinates) {
                        const [pLng, pLat] = providerProfile.location.coordinates;
                        const [bLng, bLat] = offer.booking.location.coordinates;
                        
                        distanceKm = Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2));
                        offer.distanceKm = distanceKm; 
                    }
                }
            }

            // 4. Send Response
            return res.status(200).json({
                success: true,
                message: 'Offer details fetched successfully',
                data: offer
            });

        } catch (error) {
            console.error('Get Offer Details Error:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Something went wrong', 
                error: error.message 
            });
        }
    },
};