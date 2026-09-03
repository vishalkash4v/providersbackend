const axios = require('axios');

const sendSms = async (mobile, otp) => {
    try {
        const response = await axios.post('https://www.fast2sms.com/dev/bulkV2', {
            variables_values: String(otp), // OTP variable
            route: 'otp',                  // Default OTP route (No DLT required)
            numbers: String(mobile)        // Target mobile
        }, {
            headers: {
                'authorization': process.env.FAST2SMS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        console.log('Fast2SMS Success:', response.data);
        return true;
    } catch (error) {
        console.error('Fast2SMS Failed:', error?.response?.data || error.message);
        return false; // App crash na kare isliye false return kar rahe hain
    }
};

module.exports = sendSms;