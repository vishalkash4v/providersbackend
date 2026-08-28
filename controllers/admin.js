const User = require('../models/User');
const ProviderProfile = require('../models/ProviderProfile');
const Booking = require('../models/Booking');
const BookingOffer = require('../models/BookingOffer');
const BookingPayment = require('../models/BookingPayment');
const Service = require('../models/Service');
const TokenBlacklist = require('../models/TokenBlacklist');
const Support = require('../models/Support');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { generateToken } = require('../middleware/jwt');
const { validate } = require('../utils/fieldValidations');
const { uploadSingleFile } = require('../utils/r2uploads');

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
            
            const data = providers.map(provider => {
                const profile = profiles.find(p => p.user.toString() === provider._id.toString());
                return { ...provider.toObject(), profile: profile || null };
            });
            return res.status(200).json({ success: true, count: data.length, data });
        } catch (error) { return res.status(500).json({ success: false, message: error.message }); }
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
};