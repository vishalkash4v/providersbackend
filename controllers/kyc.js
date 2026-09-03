const Kyc = require('../models/Kyc');
const User = require('../models/User');
const { notifyUser } = require('../utils/notification');

module.exports = {
    // ============================================================
    // 1. SUBMIT KYC (User/Provider Side)
    // ============================================================
    submitKyc: async (req, res) => {
        try {
            const { documentType, frontImage, backImage } = req.body;
            const userId = req.user.id;

            if (!documentType || !frontImage || !backImage) {
                return res.status(400).json({ success: false, message: 'Document type and both images are required' });
            }

            // Check if KYC already exists
            let kyc = await Kyc.findOne({ user: userId });

            if (kyc) {
                if (kyc.status === 1) {
                    return res.status(400).json({ success: false, message: 'Your KYC is already approved.' });
                }
                
                // Update existing rejected/pending KYC
                kyc.documentType = documentType;
                kyc.frontImage = frontImage;
                kyc.backImage = backImage;
                kyc.status = 0; // Wapas pending status mein daal diya
                kyc.rejectionReason = null;
                kyc.submittedAt = new Date();
                await kyc.save();
            } else {
                // Create new KYC record
                kyc = await Kyc.create({
                    user: userId,
                    documentType,
                    frontImage,
                    backImage,
                    status: 0
                });
            }

            return res.status(200).json({ 
                success: true, 
                message: 'KYC documents submitted successfully. Please wait for admin approval.',
                data: kyc 
            });

        } catch (error) {
            return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
        }
    },

    // ============================================================
    // 2. VERIFY / REJECT KYC (Admin Side)
    // ============================================================
    reviewKyc: async (req, res) => {
        try {
            const { kycId } = req.params;
            const { status, rejectionReason } = req.body; // status: 1 (Approve), 2 (Reject)

            // Ensure only Admin can do this (Assuming req.user.role === 2 is Admin)
            // if (Number(req.user.role) !== 2) return res.status(403).json({ success: false, message: 'Unauthorized' });

            if (![1, 2].includes(Number(status))) {
                return res.status(400).json({ success: false, message: 'Invalid status. Use 1 for Approve, 2 for Reject.' });
            }

            const kyc = await Kyc.findById(kycId);
            if (!kyc) return res.status(404).json({ success: false, message: 'KYC record not found' });

            if (status === 2 && !rejectionReason) {
                return res.status(400).json({ success: false, message: 'Rejection reason is required when rejecting KYC' });
            }

            kyc.status = status;
            kyc.rejectionReason = status === 2 ? rejectionReason : null;
            kyc.verifiedAt = new Date();
            await kyc.save();

            // Update User Profile Status if Approved
            if (status === 1) {
                await User.findByIdAndUpdate(kyc.user, { $set: { isKycVerified: true } });
            } else if (status === 2) {
                await User.findByIdAndUpdate(kyc.user, { $set: { isKycVerified: false } });
            }

            // Send Notification to User
            const title = status === 1 ? 'KYC Approved ✅' : 'KYC Rejected ❌';
            const message = status === 1 
                ? 'Your identity documents have been successfully verified.' 
                : `Your KYC was rejected. Reason: ${rejectionReason}`;

            try {
                await notifyUser({
                    userId: kyc.user,
                    type: status === 1 ? 'KYC_APPROVED' : 'KYC_REJECTED',
                    title: title,
                    message: message,
                    data: { kycId: kyc._id }
                });
            } catch (notifyErr) {
                console.error('Failed to notify user about KYC status');
            }

            return res.status(200).json({ 
                success: true, 
                message: `KYC has been ${status === 1 ? 'approved' : 'rejected'}`,
                data: kyc 
            });

        } catch (error) {
            return res.status(500).json({ success: false, message: 'Server Error', error: error.message });
        }
    }
};