const crypto = require('crypto');

function generateReferralCode(length = 8) {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let code = '';

  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.randomInt(
      0,
      characters.length
    );

    code += characters[randomIndex];
  }

  return code;
}

module.exports = {
  generateReferralCode,
};