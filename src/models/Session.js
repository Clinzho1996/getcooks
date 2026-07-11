import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		device: { type: String, default: "web" }, // e.g., "ios", "android", "web"
		ip: { type: String }, // IP address
		userAgent: { type: String }, // Browser or device info
		valid: { type: Boolean, default: true }, // revoked or active
		createdAt: { type: Date, default: Date.now },
		lastUsed: { type: Date, default: Date.now },
	},
	{ timestamps: true },
);

export default mongoose.model("Session", sessionSchema);
