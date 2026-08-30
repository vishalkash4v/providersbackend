const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
    {
        // ============================================================
        // USER
        // ============================================================

        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        // ============================================================
        // SERVICE
        // ============================================================

        service: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Service',
            required: true,
            index: true,
        },

        // ============================================================
        // PROVIDER
        // Assigned only after provider accepts
        // ============================================================

        provider: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },

        // ============================================================
        // WORK IMAGES
        // ============================================================

        workImages: {
            type: [String],
            default: [],
        },

        // ============================================================
        // DESCRIPTION
        // ============================================================

        description: {
            type: String,
            default: '',
            trim: true,
        },

        // ============================================================
        // MATERIAL
        // ============================================================

        materialRequired: {
            type: Boolean,
            default: false,
        },

        materialOption: {
            type: String,          
            default: '',
        },

        // ============================================================
        // LOCATION
        // ============================================================

        location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },

            coordinates: {
                type: [Number],
                required: true,
            },
        },

        address: {
            type: String,
            default: '',
            trim: true,
        },

        // ============================================================
        // VISIT PREFERENCE
        // ============================================================

        visitPreference: {
            type: String,
            enum: [
                'immediate',
                'scheduled',
            ],
            default: 'immediate',
        },

        // ============================================================
        // USER PREFERRED DATES
        // ============================================================

        preferredDates: {
            type: [Date],
            default: [],
        },

        preferredTimeStart: {
            type: String,
            default: null,
        },

        preferredTimeEnd: {
            type: String,
            default: null,
        },

      
    // ============================================================
        // BOOKING STATUS
        // ============================================================
        status: {
            type: Number,
            enum: [0, 1, 2, 3], 
            default: 0
            // 0 = Pending / Open (Providers sending offers, User reviewing. App covers both "No Offers" and "Has Offers" via API types)
            // 1 = Assigned / Finalized (Winning Provider gave final approval & paid. The job is officially locked.)
            // 2 = Completed (Physical work finished - for future use)
            // 3 = Cancelled (User or Provider cancelled the booking entirely)
        },

        // ============================================================
        // ACTIVE / INACTIVE
        // ============================================================

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        // ============================================================
        // SOFT DELETE
        // ============================================================

        deletedAt: {
            type: Date,
            default: null,
        },

        providerVisitDate: {
            type: Date,
            default: null,
        },

        providerVisitTimeStart: {
            type: String,
            default: null,
        },

        providerVisitTimeEnd: {
            type: String,
            default: null,
        },

        dateTimeProposedBy: {
            type: String,
            enum: ['PROVIDER', 'USER', null],
            default: null,
        },

        dateTimeStatus: {
            type: String,
            enum: [
                'NOT_PROPOSED',
                'PENDING_USER',
                'PENDING_PROVIDER',
                'CONFIRMED',
            ],
            default: 'NOT_PROPOSED',
        },

        providerAcceptedAt: {
            type: Date,
            default: null,
        },

        dateTimeUpdatedAt: {
            type: Date,
            default: null,
        },

        // ============================================================
        // PROVIDERS WHO RECEIVED THIS BOOKING
        //
        // Used to compare:
        //
        // OLD PROVIDERS
        // vs
        // NEW PROVIDERS
        //
        // when booking is updated.
        // ============================================================

        notifiedProviders: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
            },
        ],

        ignoredProviders: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    },

    {
        timestamps: true,
    }
);

// ============================================================
// GEO INDEX
// ============================================================

bookingSchema.index({
    location: '2dsphere',
});

// ============================================================
// EXPORT
// ============================================================

module.exports =
    mongoose.model(
        'Booking',
        bookingSchema
    );