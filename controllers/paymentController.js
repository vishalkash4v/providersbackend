const Booking = require('../models/Booking');
const BookingOffer = require('../models/BookingOffer');
const BookingPayment = require('../models/BookingPayment');
const Referral = require('../models/Referral');
const User = require('../models/User');

const {
    createRazorpayOrder,
    verifyPaymentSignature,
    verifyWebhookSignature,
    fetchRazorpayPayment,
    razorpay,
} = require('../utils/razorpay');

const {
    addBookingCredits,
} = require('../utils/bookingCredits');



// ============================================================
// EJS PAYMENT CHECKOUT PAGE
// ============================================================
// GET
// /api/payment/booking/checkout/:offerId
// ============================================================

const renderBookingCheckout =
    async (req, res) => {
        try {
            const {
                offerId,
            } = req.params;

            if (!offerId) {
                return res.status(400).send(
                    'offerId is required'
                );
            }

            const offer =
                await BookingOffer.findById(
                    offerId
                );

            if (!offer) {
                return res.status(404).send(
                    'Offer not found'
                );
            }

            if (
                offer.provider.toString() !==
                req.user.id.toString()
            ) {
                return res.status(403).send(
                    'You are not authorized for this offer'
                );
            }

            if (
                offer.status !==
                'USER_ACCEPTED'
            ) {
                return res.status(400).send(
                    'This offer is not waiting for provider approval'
                );
            }

            const booking =
                await Booking.findById(
                    offer.booking
                );

            if (!booking) {
                return res.status(404).send(
                    'Booking not found'
                );
            }

            const provider =
                await User.findById(
                    req.user.id
                ).select(
                    'firstName lastName email mobile'
                );

            if (!provider) {
                return res.status(404).send(
                    'Provider not found'
                );
            }

            if (
                Number(
                    provider.bookingCredits || 0
                ) > 0
            ) {
                return res.status(400).send(
                    'You have free booking credits. Payment is not required.'
                );
            }

            if (
                offer.distanceKm === null ||
                offer.distanceKm === undefined
            ) {
                return res.status(400).send(
                    'Booking distance is not available'
                );
            }

            const accessFee =
                getBookingAccessFee({
                    distanceKm:
                        offer.distanceKm,
                });

            let payment =
                await BookingPayment.findOne({
                    offer:
                        offer._id,

                    provider:
                        req.user.id,

                    status: {
                        $in: [
                            'CREATED',
                            'PENDING',
                        ],
                    },
                });

            // Create order automatically if needed
            if (!payment) {

                const receipt =
                    `booking_${String(
                        booking._id
                    ).slice(-12)}_${Date.now()}`;

                const razorpayOrder =
                    await createRazorpayOrder({
                        amount:
                            accessFee,

                        currency:
                            'INR',

                        receipt,

                        notes: {
                            bookingId:
                                String(
                                    booking._id
                                ),

                            offerId:
                                String(
                                    offer._id
                                ),

                            providerId:
                                String(
                                    req.user.id
                                ),

                            type:
                                'BOOKING_ACCESS_FEE',
                        },
                    });

                payment =
                    await BookingPayment.create({
                        booking:
                            booking._id,

                        offer:
                            offer._id,

                        provider:
                            req.user.id,

                        amount:
                            accessFee,

                        currency:
                            'INR',

                        razorpayOrderId:
                            razorpayOrder.id,

                        status:
                            'CREATED',

                        description:
                            'Provider job access fee',
                    });

                offer.accessType =
                    'PAID';

                offer.accessFee =
                    accessFee;

                offer.paymentStatus =
                    'PENDING';

                await offer.save();
            }

            return res.render(
                'payment/checkout',
                {
                    razorpayKeyId:
                        process.env
                            .RAZORPAY_KEY_ID,

                    razorpayOrderId:
                        payment.razorpayOrderId,

                    amount:
                        payment.amount,

                    amountInPaise:
                        Math.round(
                            Number(
                                payment.amount
                            ) * 100
                        ),

                    currency:
                        payment.currency,

                    bookingId:
                        booking._id.toString(),

                    offerId:
                        offer._id.toString(),

                    distanceKm:
                        offer.distanceKm,

                    providerName:
                        `${provider.firstName || ''} ${provider.lastName || ''}`.trim(),

                    providerEmail:
                        provider.email,

                    providerMobile:
                        provider.mobile,
                }
            );

        } catch (error) {

            console.error(
                'Render Booking Checkout Error:',
                error
            );

            return res.status(500).send(
                'Unable to load payment page'
            );
        }
    };
// ============================================================
// CALCULATE BOOKING ACCESS FEE
// ============================================================

const getBookingAccessFee = ({
    distanceKm,
}) => {
    const distance =
        Number(distanceKm);

    if (
        !Number.isFinite(distance) ||
        distance < 0
    ) {
        throw new Error(
            'Invalid booking distance'
        );
    }

    const baseFee =
        Number(
            process.env.BOOKING_FEE_BASE || 20
        );

    const perKmFee =
        Number(
            process.env.BOOKING_FEE_PER_KM || 5
        );

    const amount =
        Number(
            (
                baseFee +
                distance * perKmFee
            ).toFixed(2)
        );

    if (
        !Number.isFinite(amount) ||
        amount <= 0
    ) {
        throw new Error(
            'Invalid booking access fee'
        );
    }

    return amount;
};


// ============================================================
// REFERRAL SUCCESS
// ============================================================
// Referral becomes SUCCESS on the referred provider's
// first successfully assigned job.
// Works for both FREE and PAID approval.
// ============================================================

const completeReferralIfRequired = async ({
    providerId,
    bookingId,
}) => {
    const referral =
        await Referral.findOne({
            referredProvider:
                providerId,

            status:
                'PENDING',
        });

    if (!referral) {
        return null;
    }

    const rewardCredits =
        Number(
            process.env
                .PROVIDER_FREE_BOOKINGS_PER_REFERRAL ||
            0
        );

    // Even if reward is 0, the referral itself
    // should still become SUCCESS.
    if (rewardCredits > 0) {
        await addBookingCredits({
            providerId:
                referral.referrer,

            amount:
                rewardCredits,

            type:
                'REFERRAL_REWARD',

            referral:
                referral._id,

            booking:
                bookingId,

            description:
                'Referral reward for referred provider first approved job',
        });
    }

    referral.status =
        'SUCCESS';

    referral.firstBooking =
        bookingId;

    referral.successfulAt =
        new Date();

    referral.rewardCredits =
        rewardCredits;

    await referral.save();

    return referral;
};


// ============================================================
// REJECT OTHER OFFERS
// ============================================================

const rejectOtherOffers = async ({
    bookingId,
    winningOfferId,
}) => {
    await BookingOffer.updateMany(
        {
            booking:
                bookingId,

            _id: {
                $ne:
                    winningOfferId,
            },

            status: {
                $in: [
                    'PENDING',
                    'USER_ACCEPTED',
                ],
            },
        },
        {
            $set: {
                status:
                    'REJECTED',
            },
        }
    );
};


// ============================================================
// REFUND LOSING PAYMENT
// ============================================================

const refundLosingPayment = async ({
    payment,
}) => {
    if (
        !payment ||
        !payment.razorpayPaymentId
    ) {
        return null;
    }

    // Already refunded
    if (
        payment.status ===
        'REFUNDED'
    ) {
        return null;
    }

    try {
        const refund =
            await razorpay.payments.refund(
                payment.razorpayPaymentId,
                {
                    amount: Math.round(
                        Number(
                            payment.amount
                        ) * 100
                    ),

                    notes: {
                        reason:
                            'Another provider won the booking',
                        bookingId:
                            String(
                                payment.booking
                            ),
                        offerId:
                            String(
                                payment.offer
                            ),
                    },
                }
            );

        payment.status =
            'REFUNDED';

        payment.failureReason =
            'Booking was already assigned to another provider. Payment refunded.';

        await payment.save();

        return refund;
    } catch (error) {
        console.error(
            'Refund Losing Payment Error:',
            error
        );

        // Keep payment as PAID because refund did not complete.
        // Manual/admin retry can be handled later.
        return null;
    }
};


// ============================================================
// FINALIZE PAID BOOKING
// ============================================================

const finalizePaidBooking = async ({
    payment,
}) => {
    if (!payment) {
        return {
            success: false,
            message:
                'Payment record not found',
        };
    }

    const offer =
        await BookingOffer.findById(
            payment.offer
        );

    if (!offer) {
        return {
            success: false,
            message:
                'Booking offer not found',
        };
    }

    const booking =
        await Booking.findById(
            payment.booking
        );

    if (!booking) {
        return {
            success: false,
            message:
                'Booking not found',
        };
    }

    // ========================================================
    // ALREADY FINALIZED
    // ========================================================

    if (
        offer.status ===
            'PROVIDER_APPROVED' &&
        booking.provider &&
        booking.provider.toString() ===
            payment.provider.toString()
    ) {
        payment.status =
            'PAID';

        if (!payment.paidAt) {
            payment.paidAt =
                new Date();
        }

        await payment.save();

        return {
            success:
                true,

            alreadyFinalized:
                true,

            booking:
                booking,

            offer:
                offer,

            payment:
                payment,
        };
    }

    // ========================================================
    // BOOKING ALREADY WON BY SOMEONE ELSE
    // ========================================================

    if (
        booking.provider &&
        booking.provider.toString() !==
            payment.provider.toString()
    ) {
        offer.status =
            'REJECTED';

        offer.paymentStatus =
            'PAID';

        await offer.save();

        await refundLosingPayment({
            payment,
        });

        return {
            success:
                false,

            bookingAlreadyAssigned:
                true,

            message:
                'Another provider has already been assigned this booking. Payment refund initiated.',
        };
    }

    // ========================================================
    // OFFER MUST BE USER ACCEPTED
    // ========================================================

    if (
        offer.status !==
        'USER_ACCEPTED'
    ) {
        return {
            success:
                false,

            message:
                'This offer is no longer waiting for provider approval',
        };
    }

    // ========================================================
    // ATOMIC BOOKING CLAIM
    // ========================================================
    //
    // First successful provider wins.
    //
    // Only one request can change:
    //
    // provider: null
    //        ↓
    // provider: current provider
    //
    // ========================================================

    const claimedBooking =
        await Booking.findOneAndUpdate(
            {
                _id:
                    booking._id,

                status:
                    'PENDING',

                isActive:
                    true,

                provider:
                    null,
            },
            {
                $set: {
                    provider:
                        payment.provider,

                    status:
                        'PROVIDER_ACCEPTED',

                    providerAcceptedAt:
                        new Date(),
                },
            },
            {
                new:
                    true,
            }
        );

    // ========================================================
    // THIS PROVIDER LOST THE RACE
    // ========================================================

    if (!claimedBooking) {
        offer.status =
            'REJECTED';

        offer.paymentStatus =
            'PAID';

        await offer.save();

        await refundLosingPayment({
            payment,
        });

        return {
            success:
                false,

            bookingAlreadyAssigned:
                true,

            message:
                'Another provider has already been assigned this booking. Payment refund initiated.',
        };
    }

    // ========================================================
    // PAYMENT IS SUCCESSFUL
    // ========================================================

    payment.status =
        'PAID';

    payment.paidAt =
        payment.paidAt ||
        new Date();

    await payment.save();

    // ========================================================
    // UPDATE OFFER
    // ========================================================

    offer.accessType =
        'PAID';

    offer.paymentStatus =
        'PAID';

    offer.providerApprovedAt =
        new Date();

    offer.status =
        'PROVIDER_APPROVED';

    offer.paymentId =
        payment.razorpayPaymentId ||
        null;

    await offer.save();

    // ========================================================
    // COMPLETE REFERRAL
    // ========================================================

    await completeReferralIfRequired({
        providerId:
            payment.provider,

        bookingId:
            claimedBooking._id,
    });

    // ========================================================
    // REJECT OTHER OFFERS
    // ========================================================

    await rejectOtherOffers({
        bookingId:
            claimedBooking._id,

        winningOfferId:
            offer._id,
    });

    return {
        success:
            true,

        booking:
            claimedBooking,

        offer:
            offer,

        payment:
            payment,
    };
};


// ============================================================
// CREATE BOOKING PAYMENT ORDER
// ============================================================

const createBookingPaymentOrder =
    async (req, res) => {
        try {
            const {
                offerId,
            } = req.body;

            if (!offerId) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'offerId is required',
                });
            }

            // ====================================================
            // FIND OFFER
            // ====================================================

            const offer =
                await BookingOffer.findById(
                    offerId
                );

            if (!offer) {
                return res.status(404).json({
                    success:
                        false,

                    message:
                        'Offer not found',
                });
            }

            // ====================================================
            // PROVIDER AUTHORIZATION
            // ====================================================

            if (
                offer.provider.toString() !==
                req.user.id.toString()
            ) {
                return res.status(403).json({
                    success:
                        false,

                    message:
                        'You are not authorized for this offer',
                });
            }

            // ====================================================
            // OFFER STATUS
            // ====================================================

            if (
                offer.status !==
                'USER_ACCEPTED'
            ) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'This offer is not waiting for provider approval',
                });
            }

            // ====================================================
            // APPROVAL WINDOW
            // ====================================================

            if (
                offer.providerApprovalExpiresAt &&
                offer.providerApprovalExpiresAt <
                    new Date()
            ) {
                offer.status =
                    'EXPIRED';

                await offer.save();

                return res.status(400).json({
                    success:
                        false,

                    message:
                        'Provider approval window has expired',
                });
            }

            // ====================================================
            // BOOKING
            // ====================================================

            const booking =
                await Booking.findById(
                    offer.booking
                );

            if (!booking) {
                return res.status(404).json({
                    success:
                        false,

                    message:
                        'Booking not found',
                });
            }

            if (
                !booking.isActive ||
                booking.status !==
                    'PENDING'
            ) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'This booking is no longer available',
                });
            }

            // ====================================================
            // PROVIDER
            // ====================================================

            const provider =
                await User.findById(
                    req.user.id
                );

            if (!provider) {
                return res.status(404).json({
                    success:
                        false,

                    message:
                        'Provider not found',
                });
            }

            // ====================================================
            // FREE CREDIT AVAILABLE
            // ====================================================

            if (
                Number(
                    provider.bookingCredits ||
                    0
                ) > 0
            ) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'You have a free booking credit available. Payment is not required.',

                    code:
                        'FREE_BOOKING_CREDIT_AVAILABLE',

                    bookingCredits:
                        Number(
                            provider.bookingCredits ||
                            0
                        ),
                });
            }

            // ====================================================
            // DISTANCE
            // ====================================================

            if (
                offer.distanceKm ===
                    null ||
                offer.distanceKm ===
                    undefined
            ) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'Booking distance is not available',
                });
            }

            // ====================================================
            // CALCULATE FEE SERVER SIDE
            // ====================================================

            const accessFee =
                getBookingAccessFee({
                    distanceKm:
                        offer.distanceKm,
                });

            // ====================================================
            // EXISTING PAYMENT
            // ====================================================

            const existingPayment =
                await BookingPayment.findOne({
                    offer:
                        offer._id,

                    provider:
                        req.user.id,

                    status: {
                        $in: [
                            'CREATED',
                            'PENDING',
                        ],
                    },
                });

            if (existingPayment) {
                return res.status(200).json({
                    success:
                        true,

                    message:
                        'Existing payment order found',

                    data: {
                        paymentId:
                            existingPayment._id,

                        offerId:
                            offer._id,

                        bookingId:
                            booking._id,

                        razorpayOrderId:
                            existingPayment
                                .razorpayOrderId,

                        amount:
                            existingPayment.amount,

                        amountInPaise:
                            Math.round(
                                Number(
                                    existingPayment.amount
                                ) *
                                100
                            ),

                        currency:
                            existingPayment.currency,

                        razorpayKeyId:
                            process.env
                                .RAZORPAY_KEY_ID,
                    },
                });
            }

            // ====================================================
            // CREATE RAZORPAY ORDER
            // ====================================================

            const receipt =
                `booking_${String(
                    booking._id
                ).slice(-12)}_${Date.now()}`;

            const razorpayOrder =
                await createRazorpayOrder({
                    amount:
                        accessFee,

                    currency:
                        'INR',

                    receipt:

                        receipt,

                    notes: {
                        bookingId:
                            String(
                                booking._id
                            ),

                        offerId:
                            String(
                                offer._id
                            ),

                        providerId:
                            String(
                                req.user.id
                            ),

                        type:
                            'BOOKING_ACCESS_FEE',
                    },
                });

            // ====================================================
            // SAVE PAYMENT
            // ====================================================

            const payment =
                await BookingPayment.create({
                    booking:
                        booking._id,

                    offer:
                        offer._id,

                    provider:
                        req.user.id,

                    amount:
                        accessFee,

                    currency:
                        'INR',

                    razorpayOrderId:
                        razorpayOrder.id,

                    status:
                        'CREATED',

                    description:
                        'Provider job access fee',
                });

            // ====================================================
            // UPDATE OFFER
            // ====================================================

            offer.accessType =
                'PAID';

            offer.accessFee =
                accessFee;

            offer.paymentStatus =
                'PENDING';

            await offer.save();

            return res.status(201).json({
                success:
                    true,

                message:
                    'Payment order created successfully',

                data: {
                    paymentId:
                        payment._id,

                    offerId:
                        offer._id,

                    bookingId:
                        booking._id,

                    razorpayOrderId:
                        razorpayOrder.id,

                    razorpayKeyId:
                        process.env
                            .RAZORPAY_KEY_ID,

                    amount:
                        accessFee,

                    amountInPaise:
                        razorpayOrder.amount,

                    currency:
                        razorpayOrder.currency,

                    name:
                        'Provider App',

                    description:
                        'Booking access fee',

                    prefill: {
                        name:
                            `${provider.firstName} ${provider.lastName}`.trim(),

                        email:
                            provider.email,

                        contact:
                            provider.mobile,
                    },
                },
            });

        } catch (error) {
            console.error(
                'Create Booking Payment Order Error:',
                error
            );

            return res.status(500).json({
                success:
                    false,

                message:
                    'Something went wrong',

                error:
                    error.message,
            });
        }
    };


// ============================================================
// VERIFY CHECKOUT PAYMENT
// ============================================================

const verifyBookingPayment =
    async (req, res) => {
        try {
            const {
                offerId,
                razorpayOrderId,
                razorpayPaymentId,
                razorpaySignature,
            } = req.body;

            if (
                !offerId ||
                !razorpayOrderId ||
                !razorpayPaymentId ||
                !razorpaySignature
            ) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'offerId, razorpayOrderId, razorpayPaymentId and razorpaySignature are required',
                });
            }

            const payment =
                await BookingPayment.findOne({
                    offer:
                        offerId,

                    provider:
                        req.user.id,

                    razorpayOrderId:
                        razorpayOrderId,
                });

            if (!payment) {
                return res.status(404).json({
                    success:
                        false,

                    message:
                        'Payment record not found',
                });
            }

            // ====================================================
            // VERIFY ORDER ID
            // ====================================================

            if (
                payment.razorpayOrderId !==
                razorpayOrderId
            ) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'Invalid Razorpay order',
                });
            }

            // ====================================================
            // VERIFY SIGNATURE
            // ====================================================

            const isValid =
                verifyPaymentSignature({
                    orderId:
                        payment.razorpayOrderId,

                    paymentId:
                        razorpayPaymentId,

                    signature:
                        razorpaySignature,
                });

            if (!isValid) {
                payment.status =
                    'FAILED';

                payment.failedAt =
                    new Date();

                payment.failureReason =
                    'Invalid Razorpay payment signature';

                await payment.save();

                return res.status(400).json({
                    success:
                        false,

                    message:
                        'Invalid payment signature',
                });
            }

            // ====================================================
            // SAVE PAYMENT IDS
            // ====================================================

            payment.razorpayPaymentId =
                razorpayPaymentId;

            payment.razorpaySignature =
                razorpaySignature;

            payment.status =
                'PENDING';

            await payment.save();

            // ====================================================
            // FETCH PAYMENT FROM RAZORPAY
            // ====================================================

            let razorpayPayment;

            try {
                razorpayPayment =
                    await fetchRazorpayPayment(
                        razorpayPaymentId
                    );
            } catch (fetchError) {
                console.error(
                    'Fetch Razorpay Payment Error:',
                    fetchError
                );

                return res.status(200).json({
                    success:
                        true,

                    message:
                        'Payment received. Waiting for Razorpay webhook confirmation.',

                    data: {
                        paymentId:
                            payment._id,

                        status:
                            payment.status,
                    },
                });
            }

            // ====================================================
            // CAPTURED
            // ====================================================

            if (
                razorpayPayment &&
                razorpayPayment.status ===
                    'captured'
            ) {
                const result =
                    await finalizePaidBooking({
                        payment:
                            payment,
                    });

                if (
                    result.success
                ) {
                    return res.status(200).json({
                        success:
                            true,

                        message:
                            'Payment verified and booking approved successfully',

                        data: {
                            payment:
                                result.payment,

                            offer:
                                result.offer,

                            booking:
                                result.booking,
                        },
                    });
                }

                return res.status(409).json({
                    success:
                        false,

                    message:
                        result.message,

                    code:
                        result.bookingAlreadyAssigned
                            ? 'BOOKING_ALREADY_ASSIGNED'
                            : 'PAYMENT_PROCESSING_ERROR',

                    data: {
                        paymentId:
                            payment._id,
                    },
                });
            }

            return res.status(200).json({
                success:
                    true,

                message:
                    'Payment signature verified. Waiting for payment capture/webhook.',

                data: {
                    paymentId:
                        payment._id,

                    razorpayPaymentId:
                        payment.razorpayPaymentId,

                    status:
                        payment.status,
                },
            });

        } catch (error) {
            console.error(
                'Verify Booking Payment Error:',
                error
            );

            return res.status(500).json({
                success:
                    false,

                message:
                    'Something went wrong',

                error:
                    error.message,
            });
        }
    };


// ============================================================
// RAZORPAY WEBHOOK
// ============================================================

const razorpayWebhook =
    async (req, res) => {
        try {
            const signature =
                req.headers[
                    'x-razorpay-signature'
                ];

            if (!signature) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'Missing Razorpay webhook signature',
                });
            }

            // ====================================================
            // VERIFY RAW BODY
            // ====================================================

            const isValid =
                verifyWebhookSignature({
                    rawBody:
                        req.body,

                    signature:
                        signature,
                });

            if (!isValid) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'Invalid Razorpay webhook signature',
                });
            }

            // ====================================================
            // PARSE RAW BODY
            // ====================================================

            let eventBody;

            try {
                eventBody =
                    JSON.parse(
                        req.body.toString(
                            'utf8'
                        )
                    );
            } catch (
                parseError
            ) {
                return res.status(400).json({
                    success:
                        false,

                    message:
                        'Invalid webhook payload',
                });
            }

            const event =
                eventBody.event;

            // ====================================================
            // PAYMENT CAPTURED / ORDER PAID
            // ====================================================

            if (
                event ===
                    'payment.captured' ||
                event ===
                    'order.paid'
            ) {
                let orderId =
                    null;

                let paymentId =
                    null;

                if (
                    event ===
                    'payment.captured'
                ) {
                    orderId =
                        eventBody
                            ?.payload
                            ?.payment
                            ?.entity
                            ?.order_id;

                    paymentId =
                        eventBody
                            ?.payload
                            ?.payment
                            ?.entity
                            ?.id;
                }

                if (
                    event ===
                    'order.paid'
                ) {
                    orderId =
                        eventBody
                            ?.payload
                            ?.order
                            ?.entity
                            ?.id;

                    paymentId =
                        eventBody
                            ?.payload
                            ?.payment
                            ?.entity
                            ?.id;
                }

                if (!orderId) {
                    return res.status(200).json({
                        success:
                            true,

                        message:
                            'Webhook received but order ID was not found',
                    });
                }

                const payment =
                    await BookingPayment.findOne({
                        razorpayOrderId:
                            orderId,
                    });

                if (!payment) {
                    return res.status(200).json({
                        success:
                            true,

                        message:
                            'Webhook received for unknown order',
                    });
                }

                // ==================================================
                // UPDATE PAYMENT DETAILS
                // ==================================================

                payment.razorpayPaymentId =
                    paymentId ||
                    payment.razorpayPaymentId;

                payment.webhookVerified =
                    true;

                payment.webhookEvent =
                    event;

                await payment.save();

                // ==================================================
                // FINALIZE
                // ==================================================

                const result =
                    await finalizePaidBooking({
                        payment:
                            payment,
                    });

                // ==================================================
                // SUCCESS
                // ==================================================

                if (
                    result.success
                ) {
                    return res.status(200).json({
                        success:
                            true,

                        message:
                            'Payment webhook processed and booking approved',
                    });
                }

                // ==================================================
                // OTHER PROVIDER WON
                // ==================================================

                if (
                    result.bookingAlreadyAssigned
                ) {
                    return res.status(200).json({
                        success:
                            true,

                        message:
                            'Payment received, but another provider won the booking. Refund processed/initiated.',
                    });
                }

                return res.status(200).json({
                    success:
                        true,

                    message:
                        result.message ||
                        'Webhook processed',
                });
            }

            // ====================================================
            // PAYMENT FAILED
            // ====================================================

            if (
                event ===
                'payment.failed'
            ) {
                const paymentId =
                    eventBody
                        ?.payload
                        ?.payment
                        ?.entity
                        ?.id;

                const orderId =
                    eventBody
                        ?.payload
                        ?.payment
                        ?.entity
                        ?.order_id;

                let payment =
                    null;

                if (orderId) {
                    payment =
                        await BookingPayment.findOne({
                            razorpayOrderId:
                                orderId,
                        });
                }

                if (
                    !payment &&
                    paymentId
                ) {
                    payment =
                        await BookingPayment.findOne({
                            razorpayPaymentId:
                                paymentId,
                        });
                }

                if (payment) {
                    payment.razorpayPaymentId =
                        paymentId ||
                        payment.razorpayPaymentId;

                    payment.status =
                        'FAILED';

                    payment.failedAt =
                        new Date();

                    payment.webhookVerified =
                        true;

                    payment.webhookEvent =
                        event;

                    payment.failureReason =
                        eventBody
                            ?.payload
                            ?.payment
                            ?.entity
                            ?.error_description ||
                        'Razorpay payment failed';

                    await payment.save();

                    const offer =
                        await BookingOffer.findById(
                            payment.offer
                        );

                    if (offer) {
                        offer.paymentStatus =
                            'FAILED';

                        await offer.save();
                    }
                }

                return res.status(200).json({
                    success:
                        true,

                    message:
                        'Payment failure webhook processed',
                });
            }

            // ====================================================
            // OTHER WEBHOOK EVENTS
            // ====================================================

            return res.status(200).json({
                success:
                    true,

                message:
                    'Webhook received',
            });

        } catch (error) {
            console.error(
                'Razorpay Webhook Error:',
                error
            );

            return res.status(500).json({
                success:
                    false,

                message:
                    'Webhook processing failed',
            });
        }
    };


// ============================================================
// GET PAYMENT STATUS
// ============================================================

const getBookingPaymentStatus =
    async (req, res) => {
        try {
            const {
                offerId,
            } = req.params;

            const payment =
                await BookingPayment.findOne({
                    offer:
                        offerId,

                    provider:
                        req.user.id,
                }).sort({
                    createdAt:
                        -1,
                });

            if (!payment) {
                return res.status(404).json({
                    success:
                        false,

                    message:
                        'Payment not found',
                });
            }

            return res.status(200).json({
                success:
                    true,

                data: {
                    paymentId:
                        payment._id,

                    bookingId:
                        payment.booking,

                    offerId:
                        payment.offer,

                    amount:
                        payment.amount,

                    currency:
                        payment.currency,

                    status:
                        payment.status,

                    razorpayOrderId:
                        payment.razorpayOrderId,

                    razorpayPaymentId:
                        payment.razorpayPaymentId,

                    paidAt:
                        payment.paidAt,

                    webhookVerified:
                        payment.webhookVerified,
                },
            });

        } catch (error) {
            console.error(
                'Get Booking Payment Status Error:',
                error
            );

            return res.status(500).json({
                success:
                    false,

                message:
                    'Something went wrong',

                error:
                    error.message,
            });
        }
    };


module.exports = {
    createBookingPaymentOrder,
    verifyBookingPayment,
    razorpayWebhook,
    getBookingPaymentStatus,
    renderBookingCheckout,
};