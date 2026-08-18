const Notification = require('../models/Notification');

const notifyUser = async ({
  userId,
  type,
  title,
  message,
  bookingId = null,
  serviceId = null,
  distanceInKm = null,
  data = {},
}) => {
  try {
    const notification =
      await Notification.create({
        user: userId,
        type,
        title,
        message,
        booking: bookingId,
        service: serviceId,
        distanceInKm,
        data,
      });

    console.log(
      `Notification saved for user ${userId}: ${message}`
    );

    return notification;
  } catch (error) {
    console.error(
      'Notification Error:',
      error.message
    );

    return null;
  }
};

module.exports = {
  notifyUser,
};