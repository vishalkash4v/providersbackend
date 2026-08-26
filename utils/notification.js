const Notification = require('../models/Notification');
const UserDevice = require('../models/UserDevice'); // Token nikalne ke liye
const admin = require('../config/firebase'); // Firebase Admin SDK import

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
    // 1. SAVE TO DATABASE (In-App Notification)
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

    console.log(`Notification saved in DB for user ${userId}: ${message}`);

    // ============================================================
    // 2. FIRE PUSH NOTIFICATION VIA FIREBASE
    // ============================================================
    try {
      // User ka latest FCM token database se nikalo
      const userDevice = await UserDevice.findOne({ user: userId }).sort({ lastActive: -1 });

      if (userDevice && userDevice.fcmToken) {
        
        // Data payload mein saari values String honi chahiye (Firebase rule)
        const stringifiedData = {};
        for (const key in data) {
            stringifiedData[key] = String(data[key]);
        }

        // Firebase ka Push Payload
        const pushPayload = {
          token: userDevice.fcmToken,
          notification: {
            title: title || 'New Notification',
            body: message || ''
          },
          data: {
            type: String(type),
            bookingId: bookingId ? String(bookingId) : '',
            serviceId: serviceId ? String(serviceId) : '',
            ...stringifiedData // extra data like orderId etc.
          }
        };

        // Firebase server se phone par push fire karo!
        const response = await admin.messaging().send(pushPayload);
        console.log(`🔔 Push Notification fired successfully to ${userId}:`, response);

      } else {
        console.log(`⚠️ No active FCM token found for user ${userId}. Push skipped.`);
      }
    } catch (fcmError) {
      console.error('Firebase Push Error:', fcmError.message);
    }

    return notification;
  } catch (error) {
    console.error('Notification Error:', error.message);
    return null;
  }
};

module.exports = {
  notifyUser,
};