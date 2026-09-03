const mongoose = require('mongoose');

const kycSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true // Ek user ki ek hi active KYC profile hogi
    },
    documentType: {
        type: String,
        enum: ['AADHAR', 'PAN', 'DRIVING_LICENSE', 'PASSPORT', 'VOTER_ID'],
        default: 'AADHAR',
        required: true
    },
    frontImage: {
        type: String,
        required: true
    },
    backImage: {
        type: String,
        required: true
    },
    status: {
        type: Number,
        default: 0, // 0 = Pending, 1 = Approved, 2 = Rejected
    },
    rejectionReason: {
        type: String,
        default: null
    },
    submittedAt: {
        type: Date,
        default: Date.now
    },
    verifiedAt: {
        type: Date,
        default: null
    }
}, { timestamps: true });

module.exports = mongoose.model('Kyc', kycSchema);