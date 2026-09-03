const Kyc = require('../models/Kyc');
const User = require('../models/User');
const { notifyUser } = require('../utils/notification');
// const { uploadSingleFile } = require('../utils/fileUpload'); 

module.exports = {
    // ============================================================
    // 1. SUBMIT KYC (User/Provider Side)
    // ============================================================
    submitKyc: async (req, res) => {
        try {
            const userId = req.user.id;
            const documentType = req.body.documentType;

            // Support both string URLs or File Uploads
            let frontImage = req.body.frontImage || null;
            let backImage = req.body.backImage || null;

            if (req.files) {
                if (req.files.frontImage) {
                    const uploadedFront = await uploadSingleFile(req, 'frontImage', 'uploads/kyc');
                    if (uploadedFront) frontImage = uploadedFront.path;
                }
                if (req.files.backImage) {
                    const uploadedBack = await uploadSingleFile(req, 'backImage', 'uploads/kyc');
                    if (uploadedBack) backImage = uploadedBack.path;
                }
            }

            if (!documentType || !frontImage || !backImage) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Document type and both front/back images are required' 
                });
            }

            let kyc = await Kyc.findOne({ user: userId });

            if (kyc) {
                if (kyc.status === 2) {
                    return res.status(400).json({ success: false, message: 'Your KYC is already approved.' });
                }
                
                kyc.documentType = documentType;
                kyc.frontImage = frontImage;
                kyc.backImage = backImage;
                kyc.status = 1; // 1 = KYC Submitted
                kyc.rejectionReason = null;
                kyc.submittedAt = new Date();
                await kyc.save();
            } else {
                kyc = await Kyc.create({
                    user: userId,
                    documentType,
                    frontImage,
                    backImage,
                    status: 1 
                });
            }

            return res.status(200).json({ 
                success: true, 
                message: 'KYC documents submitted successfully.',
                data: kyc
            });

        } catch (error) {
            console.error('KYC Submit Error:', error);
            return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
        }
    },

    // ============================================================
    // 2. VERIFY / REJECT KYC (Admin Side)
    // ============================================================
    reviewKyc: async (req, res) => {
        try {
            const { kycId } = req.params;
            
            // Extract safely for form-data
            const status = req.body.status;
            const rejectionReason = req.body.rejectionReason; 

            if (!status) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Status field is missing.' 
                });
            }

            const numericStatus = Number(status);

            if (![2, 3].includes(numericStatus)) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Invalid status. Use 2 for Approve, 3 for Reject.' 
                });
            }

            const kyc = await Kyc.findById(kycId);
            if (!kyc) return res.status(404).json({ success: false, message: 'KYC record not found' });

            // Safe string conversion to prevent crashes
            const safeReason = rejectionReason ? String(rejectionReason).trim() : '';

            if (numericStatus === 3 && !safeReason) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Rejection reason is required when rejecting KYC' 
                });
            }

            // Update DB
            kyc.status = numericStatus;
            kyc.rejectionReason = numericStatus === 3 ? safeReason : null;
            kyc.verifiedAt = new Date();
            await kyc.save();

            // Update User Profile
            if (numericStatus === 2) {
                await User.findByIdAndUpdate(kyc.user, { $set: { isKycVerified: true } });
            } else if (numericStatus === 3) {
                await User.findByIdAndUpdate(kyc.user, { $set: { isKycVerified: false } });
            }

            // Notifications
            const title = numericStatus === 2 ? 'KYC Approved ✅' : 'KYC Rejected ❌';
            const message = numericStatus === 2 
                ? 'Your identity documents have been successfully verified.' 
                : `Your KYC was rejected. Reason: ${safeReason}`;

            try {
                await notifyUser({
                    userId: kyc.user,
                    type: numericStatus === 2 ? 'KYC_APPROVED' : 'KYC_REJECTED',
                    title,
                    message,
                    data: { kycId: kyc._id }
                });
            } catch (notifyErr) {
                console.error('Notification Error:', notifyErr.message);
            }

            return res.status(200).json({ 
                success: true, 
                message: `KYC has been ${numericStatus === 2 ? 'approved' : 'rejected'}`,
                data: kyc 
            });

        } catch (error) {
            console.error('KYC Review Error:', error);
            return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
        }
    },

    // FETCH KYC LIST (ADMIN) - FILTER BY TYPE
    // ============================================================
    getKycList: async (req, res) => {
        try {
            // Pagination setup
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 20;
            const skip = (page - 1) * limit;

            // ====================== FILTER LOGIC ======================
            // Query param se 'type' nikalna (e.g., ?type=1)
            // type 0 = All, type 1 = Submitted, type 2 = Approved, type 3 = Rejected
            const type = parseInt(req.query.type);
            
            let query = {}; // Default: Type 0 (All KYCs fetch honge)

            if (type === 1) {
                query.status = 1; // Only Submitted (Pending)
            } else if (type === 2) {
                query.status = 2; // Only Approved
            } else if (type === 3) {
                query.status = 3; // Only Rejected
            }

            // ====================== DATABASE QUERY ======================
            const kycRecords = await Kyc.find(query)
                .populate({
                    path: 'user',
                    // User ki important details fetch kar rahe hain
                    select: 'firstName lastName email mobile profileImage role isKycVerified' 
                })
                .sort({ submittedAt: -1 }) // Nayi entries sabse upar
                .skip(skip)
                .limit(limit)
                .lean();

            const total = await Kyc.countDocuments(query);

            // ====================== FORMAT RESPONSE ======================
            const formattedData = kycRecords.map(kyc => {
                return {
                    kycId: kyc._id,
                    userId: kyc.user?._id || null,
                    
                    // User Details
                    firstName: kyc.user?.firstName || 'N/A',
                    lastName: kyc.user?.lastName || 'N/A',
                    email: kyc.user?.email || 'N/A',
                    mobile: kyc.user?.mobile || 'N/A',
                    profilePic: kyc.user?.profileImage || null,
                    
                    // KYC Document Details
                    documentType: kyc.documentType,
                    frontImage: kyc.frontImage,
                    backImage: kyc.backImage,
                    status: kyc.status,
                    submittedAt: kyc.submittedAt,
                    verifiedAt: kyc.verifiedAt || null,
                    rejectionReason: kyc.rejectionReason || null 
                };
            });

            return res.status(200).json({
                success: true,
                message: 'KYC records fetched successfully',
                count: formattedData.length,
                total,
                page,
                totalPages: Math.ceil(total / limit),
                data: formattedData
            });

        } catch (error) {
            console.error('Fetch KYC List Error:', error);
            return res.status(500).json({ 
                success: false, 
                message: 'Server Error', 
                error: error.message 
            });
        }
    }
};