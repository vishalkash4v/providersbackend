const ProviderProfile = require('../models/ProviderProfile');
const Booking = require('../models/Booking');           // NAYA IMPORT
const BookingOffer = require('../models/BookingOffer'); // NAYA IMPORT

module.exports = {

// ============================================================
  // GET UNIQUE SERVICES FROM NEARBY PROVIDERS & USER OFFERS
  // ============================================================
home: async (req, res) => {
    try {
      const { latitude, longitude } = req.query;

      const radius = process.env.NEARBY_RADIUS_KM;
      if (latitude === undefined || latitude === null || latitude === '') return res.status(400).json({ success: false, message: 'Latitude is required' });
      if (longitude === undefined || longitude === null || longitude === '') return res.status(400).json({ success: false, message: 'Longitude is required' });

      const parsedLatitude = Number(latitude);
      const parsedLongitude = Number(longitude);
      const parsedRadius = Number(radius);

      if (!Number.isFinite(parsedLatitude)) return res.status(400).json({ success: false, message: 'Latitude must be a valid number' });
      if (!Number.isFinite(parsedLongitude)) return res.status(400).json({ success: false, message: 'Longitude must be a valid number' });
      if (!Number.isFinite(parsedRadius)) return res.status(400).json({ success: false, message: 'Radius must be a valid number' });
      if (parsedLatitude < -90 || parsedLatitude > 90) return res.status(400).json({ success: false, message: 'Latitude must be between -90 and 90' });
      if (parsedLongitude < -180 || parsedLongitude > 180) return res.status(400).json({ success: false, message: 'Longitude must be between -180 and 180' });
      if (parsedRadius <= 0) return res.status(400).json({ success: false, message: 'Radius must be greater than 0' });

      // ============================================================
      // FIND NEARBY PROVIDERS
      // ============================================================
      const maxDistanceInMeters = parsedRadius * 1000;
      const providers = await ProviderProfile.find({
        location: {
          $near: {
            $geometry: { type: 'Point', coordinates: [parsedLongitude, parsedLatitude] },
            $maxDistance: maxDistanceInMeters,
          },
        },
      }).populate({ path: 'services', select: '_id name image isActive', match: { isActive: true } }).select('services');

      const uniqueServices = new Map();
      providers.forEach((provider) => {
        if (!provider.services || !Array.isArray(provider.services)) return;
        provider.services.forEach((service) => {
          if (!service || !service._id) return;
          if (!uniqueServices.has(service._id.toString())) {
            uniqueServices.set(service._id.toString(), { _id: service._id, name: service.name, image: service.image || null });
          }
        });
      });
      const services = Array.from(uniqueServices.values());

      // ============================================================
      // SMART AUTH EXTRACTOR (GUEST FRIENDLY)
      // ============================================================
      let userId = null;
      let userRole = null;
      
      if (req.user && req.user.id) {
          userId = req.user.id;
          userRole = Number(req.user.role);
      } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
          try {
              const jwt = require('jsonwebtoken');
              const token = req.headers.authorization.split(' ')[1];
              const decoded = jwt.verify(token, process.env.JWT_SECRET);
              userId = decoded.id;
              userRole = Number(decoded.role);
          } catch (e) { /* ignore */ }
      }

      let newOffers = [];
      let acceptedOffers = [];

      // ============================================================
      // EXACT SYNC: CUSTOMER (ROLE 0)
      // ============================================================
      if (userId && userRole === 0) {
        const userBookingIds = await Booking.find({ user: userId }).distinct('_id');

        // 1. NEW OFFERS (booking/offers)
        let rawNewOffers = await BookingOffer.find({ booking: { $in: userBookingIds }, status: 0 })
          .populate({ path: 'booking', populate: [ { path: 'service', select: 'name image' }, { path: 'user', select: 'firstName lastName profileImage' } ] })
          .populate('provider', 'firstName lastName profileImage')
          .sort({ createdAt: -1 }).limit(5).lean();

        const providerIds = [...new Set(rawNewOffers.map(o => o.provider?._id?.toString()).filter(Boolean))];
        const profiles = await ProviderProfile.find({ user: { $in: providerIds } }).select('user location').lean();
        const locationMap = {};
        profiles.forEach(p => locationMap[p.user.toString()] = p.location);

        newOffers = rawNewOffers.map(offer => {
          if (offer.provider && offer.provider._id) offer.provider.location = locationMap[offer.provider._id.toString()] || null;
          return offer;
        });

        // 2. ACCEPTED OFFERS (my-bookings?type=1)
        const acceptedOffersQuery = await BookingOffer.find({ booking: { $in: userBookingIds }, status: 1 }).distinct('booking');
        const acceptedBookingIds = acceptedOffersQuery.map(id => id.toString());

        const pendingOffersQuery = await BookingOffer.find({ booking: { $in: userBookingIds }, status: 0 }).distinct('booking');
        const pendingOffersBookingIds = pendingOffersQuery.map(id => id.toString());

        let activeBookingsRaw = await Booking.find({ user: userId, deletedAt: null, isActive: true, status: 0, _id: { $in: acceptedBookingIds } })
          .populate('service', 'name image').populate('provider', 'firstName lastName mobile email profileImage').populate('user', 'firstName lastName mobile email profileImage')
          .sort({ createdAt: -1 }).limit(5).lean();

        const activeBookingIdsForUser = activeBookingsRaw.map(b => b._id);
        const userActiveOffers = await BookingOffer.find({ booking: { $in: activeBookingIdsForUser }, status: { $in: [1, 3] } }).lean();

        acceptedOffers = activeBookingsRaw.map(booking => {
          const finalOffer = userActiveOffers.find(o => o.booking.toString() === booking._id.toString());
          booking.distanceKm = finalOffer ? finalOffer.distanceKm : null;
          booking.newStatus = pendingOffersBookingIds.includes(booking._id.toString()) ? 1 : 0;
          booking.offerId = finalOffer ? finalOffer._id : null;
          booking.offerAmount = finalOffer ? finalOffer.offerAmount : null;
          booking.proposedDate = finalOffer ? finalOffer.proposedDate : null;
          booking.proposedTime = finalOffer ? finalOffer.proposedTime : null;
          booking.accessFee = finalOffer ? finalOffer.accessFee : null;
          booking.offerStatus = finalOffer ? finalOffer.status : null;
          return booking;
        });
      } 
      
      // ============================================================
      // EXACT SYNC: PROVIDER (ROLE 1)
      // ============================================================
      else if (userId && userRole === 1) {
        
        // 1. NEW OFFERS (booking/offers)
        let rawNewOffers = await BookingOffer.find({ provider: userId, status: 0 })
          .populate({ path: 'booking', populate: [ { path: 'service', select: 'name image' }, { path: 'user', select: 'firstName lastName profileImage' } ] })
          .populate('provider', 'firstName lastName profileImage')
          .sort({ createdAt: -1 }).limit(5).lean();

        const providerProfileData = await ProviderProfile.findOne({ user: userId }).lean();
        newOffers = rawNewOffers.map(offer => {
          if (offer.provider && offer.provider._id) offer.provider.location = providerProfileData?.location || null;
          return offer;
        });

        // 2. ACCEPTED OFFERS (my-bookings?type=1)
        const providerOffers = await BookingOffer.find({ provider: userId }).lean();
        const activePendingBookingIds = providerOffers.filter(o => [0, 1].includes(o.status)).map(o => o.booking.toString());

        let activeBookingsRaw = await Booking.find({ deletedAt: null, isActive: true, status: 0, _id: { $in: activePendingBookingIds } })
          .populate('service', 'name image').populate('provider', 'firstName lastName mobile email profileImage').populate('user', 'firstName lastName mobile email profileImage')
          .sort({ createdAt: -1 }).limit(5).lean();

        const providerUser = await User.findById(userId).select('bookingCredits').lean();
        const creditsLeft = Math.max(0, Number(providerUser?.bookingCredits || 0));

        acceptedOffers = activeBookingsRaw.map(booking => {
          let distanceKm = null;
          if (providerProfileData?.location?.coordinates && booking.location?.coordinates) {
             const [pLng, pLat] = providerProfileData.location.coordinates;
             const [bLng, bLat] = booking.location.coordinates;
             distanceKm = typeof calculateDistance === 'function' ? Number(calculateDistance(bLat, bLng, pLat, pLng).toFixed(2)) : null;
          }

          const myOffer = providerOffers.find(o => o.booking.toString() === booking._id.toString());
          booking.distanceKm = distanceKm;
          booking.offerId = myOffer ? myOffer._id : null;
          booking.providerApprovalExpiresAt = (myOffer && myOffer.status === 1) ? myOffer.providerApprovalExpiresAt : null;
          booking.creditsLeft = creditsLeft;
          booking.offerAmount = myOffer ? myOffer.offerAmount : null;
          booking.proposedDate = myOffer ? myOffer.proposedDate : null;
          booking.proposedTime = myOffer ? myOffer.proposedTime : null;
          booking.accessFee = myOffer ? myOffer.accessFee : null;
          booking.offerStatus = myOffer ? myOffer.status : null;
          booking.newStatus = (myOffer && myOffer.status === 1) ? 1 : 0;
          return booking;
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Home data fetched successfully',
        radiusInKm: parsedRadius,
        count: services.length,
        data: services,
        newOffers,
        acceptedOffers
      });

    } catch (error) {
      console.error('Get User Home Error:', error);
      if (error.name === 'MongoServerError') return res.status(400).json({ success: false, message: 'Unable to find nearby services', error: error.message });
      return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
  },

  // NOTE: Agar aapke is file mein baaki functions they (jaise notifications wagera),
  // toh is block ke neeche wo add kar lena. Maine aapka bheja hua block poora complete kar diya hai.
};