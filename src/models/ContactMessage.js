// models/ContactMessage.js
import mongoose from "mongoose";

const contactMessageSchema = new mongoose.Schema(
	{
		name: {
			type: String,
			required: true,
			trim: true,
			maxlength: 100,
		},
		email: {
			type: String,
			required: true,
			lowercase: true,
			trim: true,
			maxlength: 255,
		},
		phone: {
			type: String,
			trim: true,
			maxlength: 30,
			default: "",
		},
		topic: {
			type: String,
			required: true,
			enum: [
				"General enquiry",
				"Seller support",
				"Customer order issue",
				"Payments & payouts",
				"Partnerships",
			],
		},
		message: {
			type: String,
			required: true,
			trim: true,
			maxlength: 2000,
		},
		status: {
			type: String,
			enum: ["new", "read", "replied", "closed"],
			default: "new",
		},
		ipAddress: {
			type: String,
			default: null,
		},
		userAgent: {
			type: String,
			default: null,
		},
		adminNote: {
			type: String,
			default: "",
		},
		repliedAt: {
			type: Date,
			default: null,
		},
		repliedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
	},
	{ timestamps: true },
);

contactMessageSchema.index({ status: 1, createdAt: -1 });
contactMessageSchema.index({ email: 1 });

export default mongoose.model("ContactMessage", contactMessageSchema);
