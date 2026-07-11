import mongoose from "mongoose";

const otpSchema = new mongoose.Schema(
	{
		email: {
			type: String,
			required: true,
		},
		code: {
			type: String,
			required: true,
		},
		expiresAt: {
			type: Date,
			required: true,
		},
		verified: {
			type: Boolean,
			default: false,
		},
	},
	{ timestamps: true },
);

export default mongoose.model("OTP", otpSchema);
