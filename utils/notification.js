const Notification = require('../models/Notification');
const UserDevice = require('../models/UserDevice');

require('../config/firebase');

const { getMessaging } = require('firebase-admin/messaging');

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
    // ============================================================
    // 1. SAVE TO DATABASE
    // ============================================================

    const notification = await Notification.create({
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
      `Notification saved in DB for user ${userId}: ${message}`
    );

    // ============================================================
    // 2. FIRE PUSH NOTIFICATION
    // ============================================================

    try {
      const userDevice = await UserDevice
        .findOne({ user: userId })
        .sort({ lastActive: -1 });

      if (userDevice && userDevice.deviceToken) {

        // Firebase data values must be strings
        const stringifiedData = {};

        for (const key in data) {
          stringifiedData[key] = String(data[key]);
        }

        const pushPayload = {
          token: userDevice.deviceToken,

          notification: {
            title: title || 'New Notification',
            body: message || '',
          },

          data: {
            type: String(type),

            bookingId: bookingId
              ? String(bookingId)
              : '',

            serviceId: serviceId
              ? String(serviceId)
              : '',

            ...stringifiedData,
          },
        };

        const messaging = getMessaging();

        const response = await messaging.send(pushPayload);

        console.log(
          `🔔 Push Notification fired successfully to ${userId}:`,
          response,"DEVICE_TOKEN:", userDevice.deviceToken
        );

      } else {
        console.log(
          `⚠️ No active FCM token found for user ${userId}. Push skipped.`
        );
      }

    } catch (fcmError) {
      console.error(
        'Firebase Push Error:',
        fcmError.message
      );
    }

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