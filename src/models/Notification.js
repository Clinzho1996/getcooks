// backend/models/Notification.js
import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: false, // ✅ change this
			index: true,
			default: null, // ✅ allow null
		},
		title: {
			type: String,
			required: true,
			trim: true,
		},
		body: {
			type: String,
			required: true,
		},
		type: {
			type: String,
			enum: [
				"system",
				"transaction",
				"general",
				"promotional",
				"customer",
				"cook",
				"order",
				"user",
				"payment",
				"withdrawal",
				"cook_suspension",
			],
			default: "general",
		},
		targetId: {
			type: mongoose.Schema.Types.ObjectId,
			refPath: "targetModel",
			default: null,
		},
		targetModel: {
			type: String,
			enum: ["Order", "Meal", "Review", "User", "CookProfile", "Payment"], // all models you want to reference
			default: null,
		},
		data: {
			type: mongoose.Schema.Types.Mixed,
			default: {},
		},
		isRead: {
			type: Boolean,
			default: false,
			index: true,
		},
		readAt: {
			type: Date,
			default: null,
		},
		isPushSent: {
			type: Boolean,
			default: false,
		},
		pushToken: {
			type: String,
			default: null,
		},
	},
	{ timestamps: true }, // Automatically adds createdAt and updatedAt
);

// Compound index for faster user + createdAt queries
notificationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model("Notification", notificationSchema);
