import OTPModel from "../models/OTP.js";

export const generateOTP = () => {
	return Math.floor(100000 + Math.random() * 900000).toString();
};

export const saveOTP = async (email, code) => {
	return OTPModel.create({
		email,
		code,
		expiresAt: Date.now() + 10 * 60 * 1000,
	});
};

export const verifyOTP = async (email, code) => {
	const record = await OTPModel.findOne({ email, code });
	if (!record) return false;
	if (record.expiresAt < Date.now()) return false;
	return true;
};
