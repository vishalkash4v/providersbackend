const User = require('../models/User');

const BookingCreditTransaction =
  require('../models/BookingCreditTransaction');


// ============================================================
// ADD BOOKING CREDITS
// ============================================================

const addBookingCredits = async ({
  providerId,
  amount,
  type,
  referral = null,
  booking = null,
  description = '',
}) => {
  const user =
    await User.findById(providerId);

  if (!user) {
    throw new Error('Provider not found');
  }

  const creditAmount =
    Number(amount);

  if (
    !Number.isFinite(creditAmount) ||
    creditAmount <= 0
  ) {
    throw new Error(
      'Credit amount must be greater than 0'
    );
  }

  const balanceBefore =
    Number(user.bookingCredits || 0);

  const balanceAfter =
    balanceBefore + creditAmount;

  user.bookingCredits =
    balanceAfter;

  user.bookingCreditsTotal =
    Number(user.bookingCreditsTotal || 0) +
    creditAmount;

  await user.save();

  await BookingCreditTransaction.create({
    provider: providerId,

    type,

    amount: creditAmount,

    balanceBefore,

    balanceAfter,

    referral,

    booking,

    description,
  });

  return {
    balanceBefore,
    balanceAfter,
  };
};


// ============================================================
// USE ONE BOOKING CREDIT
// ============================================================

const useBookingCredit = async ({
  providerId,
  bookingId,
}) => {
  const user =
    await User.findById(providerId);

  if (!user) {
    throw new Error('Provider not found');
  }

  const currentCredits =
    Number(user.bookingCredits || 0);

  if (currentCredits <= 0) {
    return false;
  }

  const balanceBefore =
    currentCredits;

  const balanceAfter =
    currentCredits - 1;

  user.bookingCredits =
    balanceAfter;

  await user.save();

  await BookingCreditTransaction.create({
    provider: providerId,

    type: 'BOOKING_USED',

    amount: -1,

    balanceBefore,

    balanceAfter,

    booking: bookingId,

    description:
      'Booking credit used to accept job',
  });

  return true;
};


module.exports = {
  addBookingCredits,
  useBookingCredit,
};