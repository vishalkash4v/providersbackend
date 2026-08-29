const mongoose = require('mongoose');

const policySchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['TERMS', 'PRIVACY'],
        required: true,
        unique: true // Ensures only one T&C and one Privacy Policy exists
    },
    content: {
        type: String,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Policy', policySchema);