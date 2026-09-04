const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const Booking = require('../models/Booking');
const BookingOffer = require('../models/BookingOffer');
const BookingPayment = require('../models/BookingPayment');
const Service = require('../models/Service');
const TokenBlacklist = require('../models/TokenBlacklist');
const Support = require('../models/Support');
const Kyc = require('../models/Kyc');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Policy = require('../models/Policy');
const { generateToken } = require('../middleware/jwt');
const { validate } = require('../utils/fieldValidations');
const { uploadSingleFile } = require('../utils/r2uploads');
const { notifyUser } = require('../utils/notification');

module.exports = {

    // ============================================================
    // 🛡️ AUTHENTICATION & DASHBOARD
    // ============================================================
    adminLogin: async (req, res) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required' });

            const user = await User.findOne({ email: email.trim().toLowerCase() });
            if (!user || Number(user.role) !== 2) return res.status(401).json({ success: false, message: 'Invalid credentials or not an Admin' });

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid credentials' });

            const token = generateToken(user);
            return res.status(200).json({
                success: true, message: 'Admin login successful', token,
                data: { id: user._id, firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role }
            });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    adminLogout: async (req, res) => {
        try {
            const authHeader = req.headers['authorization'];
            const token = authHeader && authHeader.split(' ')[1];
            if (token) {
                const decoded = jwt.decode(token);
                if (decoded && decoded.exp) {
                    await TokenBlacklist.create({ token, expiresAt: new Date(decoded.exp * 1000) });
                }
            }
            return res.status(200).json({ success: true, message: 'Admin logged out successfully' });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    // ============================================================
    // 1. DASHBOARD STATS & GRAPHS
    // ============================================================
    getDashboardStats: async (req, res) => {
        try {
            // --- 1. Top Cards Data (Counts & Earnings) ---
            const totalUsers = await User.countDocuments({ role: 0 });
            const totalProviders = await User.countDocuments({ role: 1 });
            const totalBookings = await Booking.countDocuments({ deletedAt: null });

            const payments = await BookingPayment.find({ status: 'PAID' }).lean();
            const totalEarnings = payments.reduce((sum, pay) => sum + (Number(pay.amount) || 0), 0);

            // --- 2. Graph Data (Analytics) ---
            const now = new Date();

            // Graph A: Last 7 Days Bookings (Daily Trend)
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(now.getDate() - 7);

            const dailyBookings = await Booking.aggregate([
                { $match: { createdAt: { $gte: sevenDaysAgo }, deletedAt: null } },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]);

            // Graph B: Monthly Bookings (Current Year Trend)
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            const monthlyBookings = await Booking.aggregate([
                { $match: { createdAt: { $gte: startOfYear }, deletedAt: null } },
                {
                    $group: {
                        _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } }, // Example: "2026-08"
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]);

            return res.status(200).json({
                success: true,
                message: 'Dashboard stats and graphs fetched',
                data: {
                    counts: {
                        totalUsers,
                        totalProviders,
                        totalBookings,
                        totalEarnings: Number(totalEarnings.toFixed(2))
                    },
                    graphs: {
                        dailyBookings,   // Frontend pe Bar/Line chart (Last 7 days) ke liye
                        monthlyBookings  // Frontend pe Bar/Line chart (This Year) ke liye
                    }
                }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    },

    // ============================================================
    // 👤 USERS CRUD (Customers)
    // ============================================================
    getAllUsers: async (req, res) => {
        try {
            const users = await User.find({ role: 0 }).sort({ createdAt: -1 }).select('-password');
            return res.status(200).json({ success: true, count: users.length, data: users });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    getUserById: async (req, res) => {
        try {
            const user = await User.findById(req.params.id).select('-password');
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            return res.status(200).json({ success: true, data: user });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    updateUser: async (req, res) => {
        try {
            const { firstName, lastName, mobile, email, isActive } = req.body;
            const updateData = {};
            if (firstName) updateData.firstName = firstName;
            if (lastName) updateData.lastName = lastName;
            if (mobile) updateData.mobile = mobile;
            if (email) updateData.email = email;
            if (isActive !== undefined) updateData.isActive = isActive;

            const user = await User.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true }).select('-password');
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });

            return res.status(200).json({ success: true, message: 'User updated', data: user });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    deleteUser: async (req, res) => {
        try {
            const user = await User.findByIdAndDelete(req.params.id);
            if (!user) return res.status(404).json({ success: false, message: 'User not found' });
            return res.status(200).json({ success: true, message: 'User permanently deleted' });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

// ============================================================
    // 🛠️ PROVIDERS CRUD
    // ============================================================
    getAllProviders: async (req, res) => {
        try {
            const providers = await User.find({ role: 1 }).sort({ createdAt: -1 }).select('-password');
            const profiles = await ProviderProfile.find().populate('services', 'name').lean();
            
            // 👇 Fetch KYC records for all fetched providers
            const providerIds = providers.map(p => p._id);
            const kycs = await Kyc.find({ user: { $in: providerIds } }).lean();

            const data = providers.map(provider => {
                const profile = profiles.find(p => p.user.toString() === provider._id.toString());
                const kyc = kycs.find(k => k.user.toString() === provider._id.toString());
                
                return { 
                    ...provider.toObject(), 
                    profile: profile || null,
                    
                    // 👇 Injecting KYC Data 👇
                    kycStatus: kyc ? kyc.status : 0, 
                    kycRejectionReason: kyc?.rejectionReason || null,
                    
                    // Overriding isVerified so Lovable frontend works automatically without updates!
                    isVerified: kyc ? (kyc.status === 2) : false, 
                    isKycVerified: kyc ? (kyc.status === 2) : false 
                };
            });
            
            return res.status(200).json({ success: true, count: data.length, data });
        } catch (error) { 
            return res.status(500).json({ success: false, message: error.message }); 
        }
    },

    getProviderById: async (req, res) => {
        try {
            const provider = await User.findById(req.params.id).select('-password').lean();
            if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
            const profile = await ProviderProfile.findOne({ user: req.params.id }).populate('services', 'name').lean();

            return res.status(200).json({ success: true, data: { ...provider, profile } });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    updateProvider: async (req, res) => {
        try {
            // Update User Info
            const { firstName, lastName, mobile, email, isVerified, isActive, bookingCredits } = req.body;
            const userUpdate = {};
            if (firstName) userUpdate.firstName = firstName;
            if (lastName) userUpdate.lastName = lastName;
            if (mobile) userUpdate.mobile = mobile;
            if (email) userUpdate.email = email;
            if (isVerified !== undefined) userUpdate.isVerified = isVerified;
            if (isActive !== undefined) userUpdate.isActive = isActive;
            if (bookingCredits !== undefined) userUpdate.bookingCredits = bookingCredits;

            const provider = await User.findByIdAndUpdate(req.params.id, { $set: userUpdate }, { new: true }).select('-password');
            if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

            // Update Profile Info (if provided)
            const { radius, address, services } = req.body;
            const profileUpdate = {};
            if (radius) profileUpdate.radius = radius;
            if (address) profileUpdate.address = address;
            if (services) profileUpdate.services = Array.isArray(services) ? services : JSON.parse(services);

            if (Object.keys(profileUpdate).length > 0) {
                await ProviderProfile.findOneAndUpdate({ user: req.params.id }, { $set: profileUpdate });
            }

            return res.status(200).json({ success: true, message: 'Provider completely updated', data: provider });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    deleteProvider: async (req, res) => {
        try {
            const provider = await User.findByIdAndDelete(req.params.id);
            if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });
            await ProviderProfile.findOneAndDelete({ user: req.params.id }); // Clean up profile
            return res.status(200).json({ success: true, message: 'Provider and profile permanently deleted' });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    // ============================================================
    // 📅 BOOKINGS CRUD
    // ============================================================
    getAllBookings: async (req, res) => {
        try {
            const bookings = await Booking.find().populate('user', 'firstName lastName').populate('provider', 'firstName lastName').populate('service', 'name').sort({ createdAt: -1 });
            return res.status(200).json({ success: true, count: bookings.length, data: bookings });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    updateBookingAdmin: async (req, res) => {
        try {
            // Admin can forcefully edit ANY detail of a booking (status, address, assign a provider directly)
            const { status, provider, address, description, isActive } = req.body;
            const updateData = {};
            if (status !== undefined) updateData.status = status;
            if (provider !== undefined) updateData.provider = provider;
            if (address) updateData.address = address;
            if (description) updateData.description = description;
            if (isActive !== undefined) updateData.isActive = isActive;

            const booking = await Booking.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true });
            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

            return res.status(200).json({ success: true, message: 'Booking forcefully updated by Admin', data: booking });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    deleteBookingAdmin: async (req, res) => {
        try {
            // Hard delete
            const booking = await Booking.findByIdAndDelete(req.params.id);
            if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });
            // Clean up related offers
            await BookingOffer.deleteMany({ booking: req.params.id });
            return res.status(200).json({ success: true, message: 'Booking and related offers permanently deleted' });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    // ============================================================
    // 🤝 OFFERS CRUD
    // ============================================================
    getAllOffers: async (req, res) => {
        try {
            const offers = await BookingOffer.find().populate('provider', 'firstName lastName').populate({ path: 'booking', select: 'status', populate: { path: 'user', select: 'firstName lastName' } }).sort({ createdAt: -1 });
            return res.status(200).json({ success: true, count: offers.length, data: offers });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    updateOfferAdmin: async (req, res) => {
        try {
            const { status, offerAmount, accessFee, paymentStatus } = req.body;
            const updateData = {};
            if (status !== undefined) updateData.status = status;
            if (offerAmount !== undefined) updateData.offerAmount = offerAmount;
            if (accessFee !== undefined) updateData.accessFee = accessFee;
            if (paymentStatus) updateData.paymentStatus = paymentStatus;

            const offer = await BookingOffer.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true });
            if (!offer) return res.status(404).json({ success: false, message: 'Offer not found' });

            return res.status(200).json({ success: true, message: 'Offer updated by Admin', data: offer });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    deleteOfferAdmin: async (req, res) => {
        try {
            const offer = await BookingOffer.findByIdAndDelete(req.params.id);
            if (!offer) return res.status(404).json({ success: false, message: 'Offer not found' });
            return res.status(200).json({ success: true, message: 'Offer permanently deleted' });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    // ============================================================
    // 💳 TRANSACTIONS CRUD
    // ============================================================
    getAllTransactions: async (req, res) => {
        try {
            const transactions = await BookingPayment.find().populate('provider', 'firstName lastName').populate('booking', '_id status').sort({ createdAt: -1 });
            return res.status(200).json({ success: true, count: transactions.length, data: transactions });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    updateTransactionAdmin: async (req, res) => {
        try {
            // Use case: Gateway fails but payment received in bank, admin forces status to 'PAID'
            const { status, amount, razorpayPaymentId } = req.body;
            const updateData = {};
            if (status) updateData.status = status;
            if (amount !== undefined) updateData.amount = amount;
            if (razorpayPaymentId) updateData.razorpayPaymentId = razorpayPaymentId;

            const transaction = await BookingPayment.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true });
            if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });

            return res.status(200).json({ success: true, message: 'Transaction forcefully updated', data: transaction });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    deleteTransactionAdmin: async (req, res) => {
        try {
            const transaction = await BookingPayment.findByIdAndDelete(req.params.id);
            if (!transaction) return res.status(404).json({ success: false, message: 'Transaction not found' });
            return res.status(200).json({ success: true, message: 'Transaction log deleted' });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    // ============================================================
    // ⚙️ SERVICES CRUD
    // ============================================================
    getAllServices: async (req, res) => {
        try {
            const services = await Service.find().populate('addedBy', 'firstName lastName email').sort({ createdAt: -1 });
            return res.status(200).json({ success: true, data: services });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    addService: async (req, res) => {
        try {
            const { name } = req.body;
            if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

            let image = null;
            if (req.files && req.files.image) {
                const uploaded = await uploadSingleFile(req, 'image', 'services');
                if (uploaded) image = uploaded.path;
            }

            const exists = await Service.findOne({ name: name.trim() });
            if (exists) return res.status(400).json({ success: false, message: 'Service already exists' });

            const service = await Service.create({ name: name.trim(), image, addedBy: req.user._id });
            return res.status(201).json({ success: true, message: 'Service added', data: service });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    updateService: async (req, res) => {
        try {
            const { name, isActive } = req.body;
            const service = await Service.findById(req.params.id);
            if (!service) return res.status(404).json({ success: false, message: 'Service not found' });

            if (name) {
                const existing = await Service.findOne({ name: name.trim(), _id: { $ne: req.params.id } });
                if (existing) return res.status(400).json({ success: false, message: 'Name already exists' });
                service.name = name.trim();
            }
            if (isActive !== undefined) service.isActive = isActive === true || isActive === 'true';

            if (req.files && req.files.image) {
                const uploaded = await uploadSingleFile(req, 'image', 'services');
                if (uploaded) service.image = uploaded.path;
            }

            await service.save();
            return res.status(200).json({ success: true, message: 'Service updated', data: service });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },

    deleteService: async (req, res) => {
        try {
            const service = await Service.findByIdAndDelete(req.params.id);
            if (!service) return res.status(404).json({ success: false, message: 'Service not found' });
            return res.status(200).json({ success: true, message: 'Service deleted' });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
    },
    getSupportTickets: async (req, res) => {
        try {
            // Fetch tickets, newest first, and populate user details
            const tickets = await Support.find()
                .populate('user', 'firstName lastName email mobile role')
                .sort({ createdAt: -1 })
                .lean();

            return res.status(200).json({
                success: true,
                message: 'Support tickets fetched successfully',
                count: tickets.length,
                data: tickets
            });
        } catch (error) {
            console.error('Get Support Tickets Error:', error);
            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message
            });
        }
    },
    // CREATE OR UPDATE (Upsert)
    upsertPolicy: async (req, res) => {
        try {
            const { type, content } = req.body;
            if (!type || !content) return res.status(400).json({ success: false, message: 'Type and content are required' });

            const policyType = type.toUpperCase();
            if (!['TERMS', 'PRIVACY'].includes(policyType)) {
                return res.status(400).json({ success: false, message: 'Invalid policy type' });
            }

            const policy = await Policy.findOneAndUpdate(
                { type: policyType },
                { content },
                { new: true, upsert: true } // Creates if it doesn't exist, updates if it does
            );

            return res.status(200).json({ success: true, message: 'Policy saved successfully', data: policy });
        } catch (error) {
            return res.status(500).json({ success: false, message: 'Error saving policy', error: error.message });
        }
    },

    // READ ALL
    getPolicies: async (req, res) => {
        try {
            const policies = await Policy.find().lean();
            return res.status(200).json({ success: true, data: policies });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    // DELETE
    deletePolicy: async (req, res) => {
        try {
            const { id } = req.params;
            await Policy.findByIdAndDelete(id);
            return res.status(200).json({ success: true, message: 'Policy deleted successfully' });
        } catch (error) {
            return res.status(500).json({ success: false, error: error.message });
        }
    },

    // ============================================================
    // FETCH PENDING PROFILE IMAGES (ADMIN)
    // ============================================================
    getPendingProfileImages: async (req, res) => {
        try {
            console.log('Fetching pending profile images for admin...');
            if (Number(req.user.role) !== 2) {
              return res.status(403).json({ success: false, message: 'Unauthorized access' });
            }

            

            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;

            // ====================== FIND USERS WITH PENDING IMAGES ======================
            const query = { 'profileImageHistory.status': 0 };

            const users = await User.find(query)
                .select('firstName lastName email mobile profileImage profileImageHistory')
                .sort({ updatedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();

            const total = await User.countDocuments(query);

            // ====================== FORMAT RESPONSE DATA ======================
            const pendingApprovals = users.map(user => {
                // Sirf wahi images filter karo jo pending (status: 0) hain
                const pendingImages = user.profileImageHistory.filter(img => img.status === 0);

                return {
                    userId: user._id,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    mobile: user.mobile,
                    currentProfileImage: user.profileImage, // Jo image abhi live hai
                    pendingImages: pendingImages // Array of new images waiting for approval
                };
            });

            // ====================== RESPONSE ======================
            return res.status(200).json({
                success: true,
                message: 'Pending profile images fetched successfully',
                count: pendingApprovals.length,
                total,
                page,
                totalPages: Math.ceil(total / limit),
                data: pendingApprovals,
            });

        } catch (error) {
            console.log('Get Pending Profile Images Error:', error);
            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message
            });
        }
    },

  // ============================================================
    // REVIEW PROVIDER PROFILE IMAGE (ADMIN)
    // ============================================================
    reviewProviderImage: async (req, res) => {
        try {
            const { providerId, imageId, status, rejectionReason } = req.body;

            // FIX: status: 1 = Approve, 2 = Reject  (0 is for Pending)
            if (![1, 2].includes(Number(status))) {
                return res.status(400).json({ success: false, message: 'Invalid status. Use 1 to approve, 2 to reject.' });
            }

            // ====================== FIND PROVIDER ======================
            const provider = await User.findById(providerId);

            if (!provider) {
                return res.status(404).json({ success: false, message: 'Provider not found' });
            }

            // ====================== FIND SPECIFIC IMAGE IN HISTORY ======================
            const imageToReview = provider.profileImageHistory.id(imageId);

            // 0 means Pending
            if (!imageToReview || imageToReview.status !== 0) {
                return res.status(404).json({ success: false, message: 'Pending image not found or already reviewed' });
            }

            // ====================== APPROVE LOGIC ======================
            if (Number(status) === 1) {
                imageToReview.status = 1; // 1 = Approved
                imageToReview.reviewedAt = new Date();

                // 👇 HAAN BHAI YAHAN ALREADY LIVE PROFILE IMAGE UPDATE HO RAHI HAI 👇
                provider.profileImage = imageToReview.image;
                
                await provider.save();

                // Send Success Notification
                try {
                    await notifyUser({
                        userId: provider._id,
                        type: 'IMAGE_APPROVED',
                        title: 'Profile Picture Approved ✅',
                        message: 'Your new profile picture has been approved and is now live.',
                    });
                } catch (notifyErr) {
                    console.error('Notification Error (Approve):', notifyErr.message);
                }

                return res.status(200).json({ success: true, message: 'Image approved successfully' });
            }

            // ====================== REJECT LOGIC ======================
            else if (Number(status) === 2) { // FIX: Use 2 for Reject
                if (!rejectionReason || String(rejectionReason).trim() === '') {
                    return res.status(400).json({ success: false, message: 'Rejection reason is required' });
                }

                imageToReview.status = 2; // FIX: 2 = Rejected
                imageToReview.rejectionReason = String(rejectionReason).trim();
                imageToReview.reviewedAt = new Date();

                await provider.save();

                // Send Rejection Notification
                try {
                    await notifyUser({
                        userId: provider._id,
                        type: 'IMAGE_REJECTED',
                        title: 'Profile Picture Rejected ❌',
                        message: `Your new profile picture was rejected. Reason: ${String(rejectionReason).trim()}`,
                    });
                } catch (notifyErr) {
                    console.error('Notification Error (Reject):', notifyErr.message);
                }

                return res.status(200).json({ success: true, message: 'Image rejected successfully' });
            }

        } catch (error) {
            console.error('Review Provider Image Error:', error);
            return res.status(500).json({
                success: false,
                message: 'Something went wrong',
                error: error.message
            });
        }
    }
};