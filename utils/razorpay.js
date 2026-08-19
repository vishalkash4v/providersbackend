const Razorpay = require('razorpay');
const crypto = require('crypto');


// ============================================================
// RAZORPAY CLIENT
// ============================================================

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});


// ============================================================
// CREATE RAZORPAY ORDER
// ============================================================

const createRazorpayOrder = async ({
  amount,
  currency = 'INR',
  receipt,
  notes = {},
}) => {
  const numericAmount = Number(amount);

  if (
    !Number.isFinite(numericAmount) ||
    numericAmount <= 0
  ) {
    throw new Error(
      'Payment amount must be greater than 0'
    );
  }

  const order = await razorpay.orders.create({
    amount: Math.round(
      numericAmount * 100
    ),
    currency,
    receipt,
    notes,
  });

  return order;
};


// ============================================================
// VERIFY CHECKOUT PAYMENT SIGNATURE
// ============================================================
//
// Razorpay signature verification:
// HMAC-SHA256(
//   razorpay_order_id + "|" + razorpay_payment_id,
//   RAZORPAY_KEY_SECRET
// )
//
// The order ID used here MUST come from our database,
// not blindly from the client.
// ============================================================

const verifyPaymentSignature = ({
  orderId,
  paymentId,
  signature,
}) => {
  if (
    !orderId ||
    !paymentId ||
    !signature
  ) {
    return false;
  }

  const body =
    `${orderId}|${paymentId}`;

  const expectedSignature =
    crypto
      .createHmac(
        'sha256',
        process.env.RAZORPAY_KEY_SECRET
      )
      .update(body)
      .digest('hex');

  try {
    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        'utf8'
      );

    const receivedBuffer =
      Buffer.from(
        String(signature),
        'utf8'
      );

    if (
      expectedBuffer.length !==
      receivedBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    );
  } catch (error) {
    return false;
  }
};


// ============================================================
// VERIFY RAZORPAY WEBHOOK SIGNATURE
// ============================================================
//
// IMPORTANT:
// rawBody MUST be the original raw request body.
// Do not JSON.stringify(req.body) after express.json()
// has already parsed it.
// ============================================================

const verifyWebhookSignature = ({
  rawBody,
  signature,
}) => {
  if (
    !rawBody ||
    !signature
  ) {
    return false;
  }

  const expectedSignature =
    crypto
      .createHmac(
        'sha256',
        process.env.RAZORPAY_WEBHOOK_SECRET
      )
      .update(
        Buffer.isBuffer(rawBody)
          ? rawBody
          : Buffer.from(
              rawBody
            )
      )
      .digest('hex');

  try {
    const expectedBuffer =
      Buffer.from(
        expectedSignature,
        'utf8'
      );

    const receivedBuffer =
      Buffer.from(
        String(signature),
        'utf8'
      );

    if (
      expectedBuffer.length !==
      receivedBuffer.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    );
  } catch (error) {
    return false;
  }
};


// ============================================================
// GET RAZORPAY ORDER
// ============================================================

const fetchRazorpayOrder = async (
  orderId
) => {
  if (!orderId) {
    throw new Error(
      'Razorpay order ID is required'
    );
  }

  return razorpay.orders.fetch(
    orderId
  );
};


// ============================================================
// GET RAZORPAY PAYMENT
// ============================================================

const fetchRazorpayPayment = async (
  paymentId
) => {
  if (!paymentId) {
    throw new Error(
      'Razorpay payment ID is required'
    );
  }

  return razorpay.payments.fetch(
    paymentId
  );
};


module.exports = {
  razorpay,

  createRazorpayOrder,

  verifyPaymentSignature,

  verifyWebhookSignature,

  fetchRazorpayOrder,

  fetchRazorpayPayment,
};