const UserDevice = require('../models/UserDevice');

// Save / update device
const saveUserDevice = async ({ userId, deviceToken, deviceType = 0 }) => {
  if (!deviceToken) return null;

  deviceType = Number(deviceType);
  if (![0, 1].includes(deviceType)) {
    throw new Error('Invalid device type. Use 0 for Android or 1 for iOS');
  }

  // 👇 PRO LOGIC: Agar yeh phone kisi doosre user ke account me active tha, toh usey deactivate kar do.
  // Isse ek device par sirf "current logged-in user" ko hi push jayegi.
  await UserDevice.updateMany(
    { deviceToken, user: { $ne: userId } },
    { $set: { isActive: false } }
  );

  return UserDevice.findOneAndUpdate(
    { user: userId, deviceToken },
    {
      $set: {
        deviceType,
        isActive: true,
        lastUsedAt: new Date(),
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
};

// Logout / deactivate one device
const removeUserDevice = async ({ userId, deviceToken }) => {
  if (!deviceToken) return null;
  return UserDevice.findOneAndUpdate(
    { user: userId, deviceToken },
    { $set: { isActive: false } },
    { new: true }
  );
};

module.exports = { saveUserDevice, removeUserDevice };