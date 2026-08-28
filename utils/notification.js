const Notification = require('../models/Notification');
const UserDevice = require('../models/UserDevice');
require('../config/firebase');
const { getMessaging } = require('firebase-admin/messaging');

const notifyUser = async ({
  userId, type, title, message, bookingId = null, serviceId = null, distanceInKm = null, data = {},
}) => {
  try {
    // 1. SAVE TO DATABASE
    const notification = await Notification.create({
      user: userId, type, title, message, booking: bookingId, service: serviceId, distanceInKm, data,
    });
    console.log(`Notification saved in DB for user ${userId}: ${message}`);

    // 2. FIRE PUSH NOTIFICATION (MULTIPLE DEVICES)
    try {
      // 👇 Sirf 'Active' devices nikalo
      const userDevices = await UserDevice.find({ user: userId, isActive: true });

      if (userDevices.length > 0) {
        // Saare tokens ka array bana lo
        const tokens = userDevices.map(device => device.deviceToken);

        const stringifiedData = {};
        for (const key in data) { stringifiedData[key] = String(data[key]); }

        // 👇 MULTICAST PAYLOAD 👇
        const pushPayload = {
          tokens: tokens, // Array of tokens (Multiple devices)
          notification: {
            title: title || 'New Notification',
            body: message || '',
          },
          data: {
            type: String(type),
            bookingId: bookingId ? String(bookingId) : '',
            serviceId: serviceId ? String(serviceId) : '',
            ...stringifiedData,
          },
        };

        const messaging = getMessaging();
        
        // 🔥 NAYA CODE: sendMulticast is deprecated. Using sendEachForMulticast 🔥
        const response = await messaging.sendEachForMulticast(pushPayload);

        console.log(`🔔 Push fired to ${userId}. Success: ${response.successCount}, Failed: ${response.failureCount}`);

        // 👇 AUTO CLEANUP: Agar app uninstall ho gayi thi, toh token ko deactivate kar do 👇
        if (response.failureCount > 0) {
          const failedTokens = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const errCode = resp.error?.code;
              // Token invalid ya NotRegistered hai (App uninstalled/Cache cleared)
              if (errCode === 'messaging/invalid-registration-token' || errCode === 'messaging/registration-token-not-registered') {
                failedTokens.push(tokens[idx]);
              }
            }
          });

          if (failedTokens.length > 0) {
            await UserDevice.updateMany(
              { deviceToken: { $in: failedTokens } },
              { $set: { isActive: false } }
            );
            console.log(`🧹 Cleaned up ${failedTokens.length} dead tokens for user ${userId}`);
          }
        }
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

module.exports = { notifyUser };