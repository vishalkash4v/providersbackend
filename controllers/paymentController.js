const crypto = require('crypto');

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
// PAYMENT MODE
// ============================================================
const isRealPaymentMode = String(process.env.PAYMENT_MODE || 'false').toLowerCase() === 'true';

// ============================================================
// CALCULATE BOOKING ACCESS FEE
// ============================================================
const getBookingAccessFee = ({ distanceKm }) => {
    const distance = Number(distanceKm);
    if (!Number.isFinite(distance) || distance < 0) throw new Error('Invalid booking distance');

    const baseFee = Number(process.env.BOOKING_FEE_BASE || 20);
    const perKmFee = Number(process.env.BOOKING_FEE_PER_KM || 5);
    const amount = Number((baseFee + distance * perKmFee).toFixed(2));

    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid booking access fee');
    return amount;
};

// ============================================================
// COMPLETE REFERRAL
// ============================================================
const completeReferralIfRequired = async ({ providerId, bookingId }) => {
    const referral = await Referral.findOne({ referredProvider: providerId, status: 'PENDING' });
    if (!referral) return null;

    const rewardCredits = Number(process.env.PROVIDER_FREE_BOOKINGS_PER_REFERRAL || 0);

    if (rewardCredits > 0) {
        await addBookingCredits({
            providerId: referral.referrer,
            amount: rewardCredits,
            type: 'REFERRAL_REWARD',
            referral: referral._id,
            booking: bookingId,
            description: 'Referral reward for referred provider first approved job',
        });
    }

    referral.status = 'SUCCESS';
    referral.firstBooking = bookingId;
    referral.successfulAt = new Date();
    referral.rewardCredits = rewardCredits;
    await referral.save();

    return referral;
};

// ============================================================
// REJECT OTHER OFFERS
// ============================================================
const rejectOtherOffers = async ({ bookingId, winningOfferId }) => {
    await BookingOffer.updateMany(
        {
            booking: bookingId,
            _id: { $ne: winningOfferId },
            status: { $in: [0, 1] }, // 0 = PENDING, 1 = USER_ACCEPTED
        },
        {
            $set: {
                status: 2, // 2 = REJECTED
                rejectionReason: 'Another provider was assigned to this job'
            },
        }
    );
};

// ============================================================
// REFUND LOSING RAZORPAY PAYMENT
// ============================================================
const refundLosingPayment = async ({ payment }) => {
    if (!isRealPaymentMode || !payment || !payment.razorpayPaymentId) return null;
    if (payment.status === 'REFUNDED') return null;

    try {
        const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
            amount: Math.round(Number(payment.amount) * 100),
            notes: {
                reason: 'Another provider won the booking',
                bookingId: String(payment.booking),
                offerId: String(payment.offer),
            },
        });

        payment.status = 'REFUNDED';
        payment.failureReason = 'Another provider won the booking. Payment refunded.';
        await payment.save();

        return refund;
    } catch (error) {
        console.error('Refund Losing Payment Error:', error);
        return null;
    }
};

// ============================================================
// FINALIZE BOOKING (Called by Webhook or Dummy)
// ============================================================
const finalizeBookingPayment = async ({ payment }) => {
    if (!payment) return { success: false, message: 'Payment record not found' };

    const offer = await BookingOffer.findById(payment.offer);
    if (!offer) return { success: false, message: 'Booking offer not found' };

    const booking = await Booking.findById(payment.booking);
    if (!booking) return { success: false, message: 'Booking not found' };

    // ========================================================
    // ALREADY FINALIZED
    // ========================================================
    if (offer.status === 3 && booking.provider && booking.provider.toString() === payment.provider.toString()) { // 3 = PROVIDER_APPROVED
        payment.status = 'PAID';
        if (!payment.paidAt) payment.paidAt = new Date();
        await payment.save();
        return { success: true, alreadyFinalized: true, booking, offer, payment };
    }

    // ========================================================
    // SOMEONE ELSE ALREADY WON
    // ========================================================
    if (booking.provider && booking.provider.toString() !== payment.provider.toString()) {
        offer.status = 2; // 2 = REJECTED
        offer.rejectionReason = 'Lost to another provider';
        offer.paymentStatus = 'PAID'; // Payment was deducted, needs refund
        await offer.save();
        await refundLosingPayment({ payment });
        return { success: false, bookingAlreadyAssigned: true, message: 'Another provider has already been assigned this booking.' };
    }

    // ========================================================
    // OFFER MUST BE USER ACCEPTED
    // ========================================================
    if (offer.status !== 1) { // 1 = USER_ACCEPTED
        return { success: false, message: 'This offer is no longer waiting for provider approval' };
    }

    // ========================================================
    // ATOMIC BOOKING CLAIM
    // ========================================================
    const claimedBooking = await Booking.findOneAndUpdate(
        {
            _id: booking._id,
            status: 0, // 0 = PENDING
            isActive: true,
            provider: null,
        },
        {
            $set: {
                provider: payment.provider,
                status: 1, // 1 = ASSIGNED/FINALIZED
                providerAcceptedAt: new Date(),
            },
        },
       { returnDocument: 'after' }
    );

    if (!claimedBooking) {
        offer.status = 2; // 2 = REJECTED
        offer.rejectionReason = 'Lost to another provider during finalization';
        offer.paymentStatus = 'PAID';
        await offer.save();
        await refundLosingPayment({ payment });
        return { success: false, bookingAlreadyAssigned: true, message: 'Another provider has already been assigned this booking.' };
    }

    // ========================================================
    // PAYMENT SUCCESS
    // ========================================================
    payment.status = 'PAID';
    payment.paidAt = payment.paidAt || new Date();
    await payment.save();

    // ========================================================
    // UPDATE OFFER
    // ========================================================
    offer.accessType = 'PAID';
    offer.paymentStatus = 'PAID';
    offer.providerApprovedAt = new Date();
    offer.status = 3; // 3 = PROVIDER_APPROVED
    offer.paymentId = payment.razorpayPaymentId || null;
    offer.paymentPaidAt = payment.paidAt;
    await offer.save();

    // ========================================================
    // COMPLETE REFERRAL & REJECT OTHERS
    // ========================================================
    await completeReferralIfRequired({ providerId: payment.provider, bookingId: claimedBooking._id });
    await rejectOtherOffers({ bookingId: claimedBooking._id, winningOfferId: offer._id });

    return { success: true, booking: claimedBooking, offer, payment };
};

// ============================================================
// CREATE DUMMY PAYMENT
// ============================================================
const createDummyPayment = async ({ booking, offer, provider, accessFee }) => {
    const existingPayment = await BookingPayment.findOne({ offer: offer._id, provider: provider._id, status: 'PAID' });
    if (existingPayment) return existingPayment;

    const dummyOrderId = `dummy_order_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const dummyPaymentId = `dummy_payment_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;

    const payment = await BookingPayment.create({
        booking: booking._id,
        offer: offer._id,
        provider: provider._id,
        amount: accessFee,
        currency: 'INR',
        razorpayOrderId: dummyOrderId,
        razorpayPaymentId: dummyPaymentId,
        status: 'PAID',
        webhookVerified: false,
        webhookEvent: 'DUMMY_PAYMENT',
        paidAt: new Date(),
        description: 'Dummy payment for development/testing',
    });

    offer.accessType = 'PAID';
    offer.accessFee = accessFee;
    offer.paymentStatus = 'PAID';
    offer.paymentId = dummyPaymentId;
    offer.paymentPaidAt = payment.paidAt;
    await offer.save();

    return payment;
};

// ============================================================
// RENDER / OPEN PAYMENT CHECKOUT PAGE
// ============================================================
const renderBookingCheckout = async (req, res) => {
    try {
        const { offerId } = req.params;
        if (!offerId) return res.status(400).send('offerId is required');

        const offer = await BookingOffer.findById(offerId);
        if (!offer) return res.status(404).send('Offer not found');

        if (offer.status !== 1) return res.status(400).send('This offer is not waiting for provider approval'); // 1 = USER_ACCEPTED

        if (offer.providerApprovalExpiresAt && offer.providerApprovalExpiresAt < new Date()) {
            offer.status = 5; // 5 = TIMEOUT/EXPIRED
            await offer.save();
            return res.status(400).send('Provider approval window has expired');
        }

        const booking = await Booking.findById(offer.booking);
        if (!booking) return res.status(404).send('Booking not found');

        if (!booking.isActive || booking.status !== 0) return res.status(400).send('This booking is no longer available'); // 0 = PENDING

        const provider = await User.findById(offer.provider).select('firstName lastName email mobile bookingCredits');
        if (!provider) return res.status(404).send('Provider not found');

        if (Number(provider.bookingCredits || 0) > 0) return res.status(400).send('Provider has free booking credits. Payment is not required.');

        if (offer.distanceKm === null || offer.distanceKm === undefined) return res.status(400).send('Booking distance is not available');

        const accessFee = getBookingAccessFee({ distanceKm: offer.distanceKm });

        if (!isRealPaymentMode) {
            const payment = await createDummyPayment({ booking, offer, provider, accessFee });
            const result = await finalizeBookingPayment({ payment });

            if (!result.success) {
                return res.status(409).json({
                    success: false,
                    message: result.message,
                    code: result.bookingAlreadyAssigned ? 'BOOKING_ALREADY_ASSIGNED' : 'DUMMY_PAYMENT_FINALIZATION_FAILED',
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Dummy payment successful and booking approved',
                paymentMode: 'DUMMY',
                data: {
                    paymentId: payment._id,
                    dummyPaymentId: payment.razorpayPaymentId,
                    booking: result.booking,
                    offer: result.offer,
                    amount: accessFee,
                },
            });
        }

        let payment = await BookingPayment.findOne({
            offer: offer._id,
            provider: offer.provider,
            status: { $in: ['CREATED', 'PENDING'] },
        });

        if (!payment) {
            const receipt = `booking_${String(booking._id).slice(-12)}_${Date.now()}`;
            const razorpayOrder = await createRazorpayOrder({
                amount: accessFee,
                currency: 'INR',
                receipt,
                notes: {
                    bookingId: String(booking._id),
                    offerId: String(offer._id),
                    providerId: String(offer.provider),
                    type: 'BOOKING_ACCESS_FEE',
                },
            });

            payment = await BookingPayment.create({
                booking: booking._id,
                offer: offer._id,
                provider: offer.provider,
                amount: accessFee,
                currency: 'INR',
                razorpayOrderId: razorpayOrder.id,
                status: 'CREATED',
                description: 'Provider job access fee',
            });

            offer.accessType = 'PAID';
            offer.accessFee = accessFee;
            offer.paymentStatus = 'PENDING';
            await offer.save();
        }

        return res.render('payment/checkout', {
            razorpayKeyId: process.env.RAZORPAY_KEY_ID,
            razorpayOrderId: payment.razorpayOrderId,
            amount: payment.amount,
            amountInPaise: Math.round(Number(payment.amount) * 100),
            currency: payment.currency,
            bookingId: booking._id.toString(),
            offerId: offer._id.toString(),
            distanceKm: offer.distanceKm,
            providerName: `${provider.firstName || ''} ${provider.lastName || ''}`.trim(),
            providerEmail: provider.email || '',
            providerMobile: provider.mobile || '',
        });

    } catch (error) {
        console.error('Render Booking Checkout Error:', error);
        return res.status(500).json({ success: false, message: 'Unable to process payment', error: error.message });
    }
};

// ============================================================
// CREATE BOOKING PAYMENT ORDER
// ============================================================
const createBookingPaymentOrder = async (req, res) => {
    try {
        const { offerId } = req.body;
        if (!offerId) return res.status(400).json({ success: false, message: 'offerId is required' });

        const offer = await BookingOffer.findById(offerId);
        if (!offer) return res.status(404).json({ success: false, message: 'Offer not found' });

        if (!offer.provider || offer.provider.toString() !== req.user.id.toString()) {
            return res.status(403).json({ success: false, message: 'You are not authorized for this offer' });
        }

        if (offer.status !== 1) return res.status(400).json({ success: false, message: 'This offer is not waiting for provider approval' }); // 1 = USER_ACCEPTED

        if (offer.providerApprovalExpiresAt && offer.providerApprovalExpiresAt < new Date()) {
            offer.status = 5; // 5 = TIMEOUT
            await offer.save();
            return res.status(400).json({ success: false, message: 'Provider approval window has expired' });
        }

        const booking = await Booking.findById(offer.booking);
        if (!booking) return res.status(404).json({ success: false, message: 'Booking not found' });

        if (!booking.isActive || booking.status !== 0) return res.status(400).json({ success: false, message: 'This booking is no longer available' }); // 0 = PENDING

        const provider = await User.findById(req.user.id);
        if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

        if (Number(provider.bookingCredits || 0) > 0) {
            return res.status(400).json({
                success: false,
                message: 'You have a free booking credit available. Payment is not required.',
                code: 'FREE_BOOKING_CREDIT_AVAILABLE',
                bookingCredits: Number(provider.bookingCredits || 0),
            });
        }

        if (offer.distanceKm === null || offer.distanceKm === undefined) return res.status(400).json({ success: false, message: 'Booking distance is not available' });

        const accessFee = getBookingAccessFee({ distanceKm: offer.distanceKm });

        if (!isRealPaymentMode) {
            const payment = await createDummyPayment({ booking, offer, provider, accessFee });
            const result = await finalizeBookingPayment({ payment });

            if (!result.success) {
                return res.status(409).json({
                    success: false,
                    message: result.message,
                    code: result.bookingAlreadyAssigned ? 'BOOKING_ALREADY_ASSIGNED' : 'DUMMY_PAYMENT_FINALIZATION_FAILED',
                    data: { paymentId: payment._id },
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Dummy payment successful and booking approved',
                paymentMode: 'DUMMY',
                data: {
                    paymentId: payment._id,
                    dummyOrderId: payment.razorpayOrderId,
                    dummyPaymentId: payment.razorpayPaymentId,
                    bookingId: booking._id,
                    offerId: offer._id,
                    amount: accessFee,
                    currency: 'INR',
                    booking: result.booking,
                    offer: result.offer,
                },
            });
        }

        const existingPayment = await BookingPayment.findOne({
            offer: offer._id,
            provider: req.user.id,
            status: { $in: ['CREATED', 'PENDING'] },
        });

        if (existingPayment) {
            return res.status(200).json({
                success: true,
                message: 'Existing payment order found',
                paymentMode: 'RAZORPAY',
                data: {
                    paymentId: existingPayment._id,
                    offerId: offer._id,
                    bookingId: booking._id,
                    razorpayOrderId: existingPayment.razorpayOrderId,
                    amount: existingPayment.amount,
                    amountInPaise: Math.round(Number(existingPayment.amount) * 100),
                    currency: existingPayment.currency,
                    razorpayKeyId: process.env.RAZORPAY_KEY_ID,
                },
            });
        }

        const receipt = `booking_${String(booking._id).slice(-12)}_${Date.now()}`;
        const razorpayOrder = await createRazorpayOrder({
            amount: accessFee,
            currency: 'INR',
            receipt,
            notes: {
                bookingId: String(booking._id),
                offerId: String(offer._id),
                providerId: String(req.user.id),
                type: 'BOOKING_ACCESS_FEE',
            },
        });

        const payment = await BookingPayment.create({
            booking: booking._id,
            offer: offer._id,
            provider: req.user.id,
            amount: accessFee,
            currency: 'INR',
            razorpayOrderId: razorpayOrder.id,
            status: 'CREATED',
            description: 'Provider job access fee',
        });

        offer.accessType = 'PAID';
        offer.accessFee = accessFee;
        offer.paymentStatus = 'PENDING';
        await offer.save();

        return res.status(201).json({
            success: true,
            message: 'Payment order created successfully',
            paymentMode: 'RAZORPAY',
            data: {
                paymentId: payment._id,
                offerId: offer._id,
                bookingId: booking._id,
                razorpayOrderId: razorpayOrder.id,
                razorpayKeyId: process.env.RAZORPAY_KEY_ID,
                amount: accessFee,
                amountInPaise: razorpayOrder.amount,
                currency: razorpayOrder.currency,
                name: 'Provider App',
                description: 'Booking access fee',
                prefill: {
                    name: `${provider.firstName} ${provider.lastName}`.trim(),
                    email: provider.email,
                    contact: provider.mobile,
                },
            },
        });
    } catch (error) {
        console.error('Create Booking Payment Order Error:', error);
        return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
};

// ============================================================
// VERIFY RAZORPAY PAYMENT
// ============================================================
const verifyBookingPayment = async (req, res) => {
    try {
        if (!isRealPaymentMode) return res.status(400).json({ success: false, message: 'Payment verification is disabled in dummy payment mode', paymentMode: 'DUMMY' });

        const { offerId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

        if (!offerId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
            return res.status(400).json({ success: false, message: 'offerId, razorpayOrderId, razorpayPaymentId and razorpaySignature are required' });
        }

        const payment = await BookingPayment.findOne({ offer: offerId, provider: req.user.id, razorpayOrderId });
        if (!payment) return res.status(404).json({ success: false, message: 'Payment record not found' });
        if (payment.razorpayOrderId !== razorpayOrderId) return res.status(400).json({ success: false, message: 'Invalid Razorpay order' });

        const isValid = verifyPaymentSignature({ orderId: payment.razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature });

        if (!isValid) {
            payment.status = 'FAILED';
            payment.failedAt = new Date();
            payment.failureReason = 'Invalid Razorpay payment signature';
            await payment.save();
            return res.status(400).json({ success: false, message: 'Invalid payment signature' });
        }

        payment.razorpayPaymentId = razorpayPaymentId;
        payment.razorpaySignature = razorpaySignature;
        await payment.save();

        let razorpayPayment;
        try {
            razorpayPayment = await fetchRazorpayPayment(razorpayPaymentId);
        } catch (fetchError) {
            console.error('Fetch Razorpay Payment Error:', fetchError);
            return res.status(200).json({ success: true, message: 'Payment received. Waiting for Razorpay confirmation.', data: { paymentId: payment._id, status: payment.status } });
        }

        if (razorpayPayment && razorpayPayment.status === 'captured') {
            const result = await finalizeBookingPayment({ payment });
            if (result.success) {
                return res.status(200).json({
                    success: true,
                    message: 'Payment verified and booking approved successfully',
                    paymentMode: 'RAZORPAY',
                    data: { payment: result.payment, offer: result.offer, booking: result.booking },
                });
            }
            return res.status(409).json({
                success: false,
                message: result.message,
                code: result.bookingAlreadyAssigned ? 'BOOKING_ALREADY_ASSIGNED' : 'PAYMENT_PROCESSING_ERROR',
                data: { paymentId: payment._id },
            });
        }

        return res.status(200).json({ success: true, message: 'Payment signature verified. Waiting for capture.', paymentMode: 'RAZORPAY', data: { paymentId: payment._id, razorpayPaymentId: payment.razorpayPaymentId, status: payment.status } });
    } catch (error) {
        console.error('Verify Booking Payment Error:', error);
        return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
};

// ============================================================
// RAZORPAY WEBHOOK (WITH ADVANCED DEBUGGING)
// ============================================================
const razorpayWebhook = async (req, res) => {
    console.log('--- 🚀 RAZORPAY WEBHOOK TRIGGERED ---');
    
    // 1. Log basic headers
    const signature = req.headers['x-razorpay-signature'];
    const eventId = req.headers['x-razorpay-event-id'];
    console.log(`[Webhook] Event ID: ${eventId}`);
    console.log(`[Webhook] Signature Received: ${signature ? 'YES' : 'NO'}`);

    if (!isRealPaymentMode) {
        console.log('[Webhook] PAYMENT_MODE is false. Returning dummy success.');
        return res.status(200).json({ success: true, message: 'Webhook disabled because PAYMENT_MODE=false', paymentMode: 'DUMMY' });
    }

    try {
        // 2. Check Signature Presence
        if (!signature) {
            console.error('❌ [Webhook Error] Missing Razorpay webhook signature');
            return res.status(400).json({ success: false, message: 'Missing Razorpay webhook signature' });
        }

        // 3. Check Secret Key in ENV
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        console.log(`[Webhook] Webhook Secret configured in ENV: ${secret ? 'YES (Length: ' + secret.length + ')' : 'NO (MISSING!)'}`);

        // 4. Verify Signature
        console.log('[Webhook] Verifying Signature...');
        const isValid = verifyWebhookSignature({ rawBody: req.body, signature });
        
        if (!isValid) {
            console.error('❌ [Webhook Error] Signature Verification FAILED!');
            console.error(`- Received Signature: ${signature}`);
            // Note: We don't print expected signature for security, but failure means secret mismatch or body parsing issue.
            return res.status(400).json({ success: false, message: 'Invalid Razorpay webhook signature' });
        }
        console.log('✅ [Webhook] Signature Verified Successfully!');

        // 5. Parse Payload
        let eventBody;
        try {
            const bodyString = req.body.toString('utf8');
            eventBody = JSON.parse(bodyString);
            console.log(`[Webhook] Payload Parsed Successfully. Event Type: ${eventBody.event}`);
        } catch (parseError) {
            console.error('❌ [Webhook Error] JSON Parsing FAILED:', parseError.message);
            return res.status(400).json({ success: false, message: 'Invalid webhook payload' });
        }

        const event = eventBody.event;

        // ====================================================
        // PAYMENT CAPTURED
        // ====================================================
        if (event === 'payment.captured' || event === 'order.paid') {
            console.log(`[Webhook] Processing Event: ${event}`);
            
            let orderId = null;
            let paymentId = null;

            if (event === 'payment.captured') {
                orderId = eventBody?.payload?.payment?.entity?.order_id;
                paymentId = eventBody?.payload?.payment?.entity?.id;
            } else if (event === 'order.paid') {
                orderId = eventBody?.payload?.order?.entity?.id;
                paymentId = eventBody?.payload?.payment?.entity?.id;
            }

            console.log(`[Webhook] Order ID: ${orderId} | Payment ID: ${paymentId}`);

            if (!orderId) {
                console.log('⚠️ [Webhook] No Order ID found in payload, returning 200.');
                return res.status(200).json({ success: true, message: 'Webhook received' });
            }

            const payment = await BookingPayment.findOne({ razorpayOrderId: orderId });
            if (!payment) {
                console.error(`❌ [Webhook Error] Unknown Order ID: ${orderId}`);
                return res.status(200).json({ success: true, message: 'Webhook received for unknown order' });
            }

            console.log('[Webhook] Payment Record Found in DB. Finalizing Booking...');

            payment.razorpayPaymentId = paymentId || payment.razorpayPaymentId;
            payment.webhookVerified = true;
            payment.webhookEvent = eventId ? `${event}:${eventId}` : event;
            await payment.save();

            const result = await finalizeBookingPayment({ payment });

            if (result.success) {
                console.log('✅ [Webhook] Booking Finalized Successfully!');
            } else {
                console.error('❌ [Webhook Error] Booking Finalization Failed:', result.message);
            }

            return res.status(200).json({ 
                success: true, 
                message: result.success ? 'Payment webhook processed and booking finalized' : 'Payment webhook processed but booking lost to another provider' 
            });
        }

        // ====================================================
        // PAYMENT FAILED
        // ====================================================
        if (event === 'payment.failed') {
            console.log(`[Webhook] Processing Event: ${event}`);
            // ... (Your existing failure handling code) ...
            const paymentId = eventBody?.payload?.payment?.entity?.id;
            const orderId = eventBody?.payload?.payment?.entity?.order_id;
            
            let payment = null;
            if (orderId) payment = await BookingPayment.findOne({ razorpayOrderId: orderId });
            if (!payment && paymentId) payment = await BookingPayment.findOne({ razorpayPaymentId: paymentId });

            if (payment) {
                console.log('[Webhook] Updating payment status to FAILED in DB.');
                payment.razorpayPaymentId = paymentId || payment.razorpayPaymentId;
                payment.status = 'FAILED';
                payment.failedAt = new Date();
                payment.webhookVerified = true;
                payment.webhookEvent = eventId ? `${event}:${eventId}` : event;
                payment.failureReason = eventBody?.payload?.payment?.entity?.error_description || 'Razorpay payment failed';
                await payment.save();

                await BookingOffer.findByIdAndUpdate(payment.offer, { $set: { paymentStatus: 'FAILED' } });
            }
            return res.status(200).json({ success: true, message: 'Payment failure webhook received' });
        }

        console.log(`[Webhook] Ignored Event: ${event}`);
        return res.status(200).json({ success: true, message: 'Webhook received' });

    } catch (error) {
        console.error('❌ [Webhook Critical Error]:', error);
        return res.status(200).json({ success: true, message: 'Webhook received but internal error occurred' });
    }
};
// ============================================================
// GET PAYMENT STATUS
// ============================================================
const getBookingPaymentStatus = async (req, res) => {
    try {
        const { offerId } = req.params;
        const payment = await BookingPayment.findOne({ offer: offerId, provider: req.user.id }).sort({ createdAt: -1 });

        if (!payment) return res.status(404).json({ success: false, message: 'Payment not found' });

        return res.status(200).json({
            success: true,
            paymentMode: isRealPaymentMode ? 'RAZORPAY' : 'DUMMY',
            data: {
                paymentId: payment._id,
                bookingId: payment.booking,
                offerId: payment.offer,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                razorpayOrderId: payment.razorpayOrderId,
                razorpayPaymentId: payment.razorpayPaymentId,
                paidAt: payment.paidAt,
                webhookVerified: payment.webhookVerified,
            },
        });
    } catch (error) {
        console.error('Get Booking Payment Status Error:', error);
        return res.status(500).json({ success: false, message: 'Something went wrong', error: error.message });
    }
};

module.exports = {
    createBookingPaymentOrder,
    verifyBookingPayment,
    razorpayWebhook,
    getBookingPaymentStatus,
    renderBookingCheckout,
};