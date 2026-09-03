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
        default: 0, // 0 = Pending, 1 = Submited, 2 = Approved, 3 = Rejected
        enum: [0, 1, 2, 3]
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