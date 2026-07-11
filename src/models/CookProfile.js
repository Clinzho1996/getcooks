// models/CookProfile.js - Updated
import mongoose from "mongoose";

const cookProfileSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},

		// Store Information
		storeName: { type: String, required: true },
		storeHandle: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
		},
		storeLink: { type: String, required: true },
		storeDescription: { type: String, maxlength: 500 },

		// Contact Information
		phone: { type: String, required: true },
		email: { type: String, required: true },

		// Location
		state: { type: String, required: true },
		kitchenAddress: { type: String, required: true },
		pickupLandmark: { type: String },

		location: {
			type: {
				type: String,
				enum: ["Point"],
				default: "Point",
			},
			coordinates: {
				type: [Number],
				default: [0, 0],
			},
		},

		// Pickup & Delivery Settings
		pickupWindow: {
			from: { type: String, required: true },
			to: { type: String, required: true },
		},
		deliveryEnabled: { type: Boolean, default: false },
		deliveryFee: { type: Number, default: 0 },
		preparationDays: { type: Number, default: 1, min: 1 },

		// Images
		profileImage: { type: String },
		coverImage: { type: String },

		// Terms
		termsAccepted: { type: Boolean, default: false },
		termsAcceptedAt: { type: Date },

		// Status
		isApproved: { type: Boolean, default: false },
		isAvailable: { type: Boolean, default: true },
		isSuspended: { type: Boolean, default: false },
		suspensionReason: { type: String },
		suspensionNote: { type: String },
		suspendedAt: { type: Date },
		suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

		// Statistics
		rating: { type: Number, default: 0 },
		reviewsCount: { type: Number, default: 0 },
		ordersCount: { type: Number, default: 0 },
		walletBalance: { type: Number, default: 0 },
		viewsThisWeek: { type: Number, default: 0 },
		viewsHistory: [
			{
				date: { type: Date, default: Date.now },
				count: { type: Number, default: 0 },
			},
		],

		// Bank Details (for payouts)
		bankDetails: {
			bankName: String,
			bankCode: String,
			accountNumber: String,
			accountName: String,
			recipientCode: String,
		},
	},
	{ timestamps: true },
);

// Indexes
cookProfileSchema.index({ location: "2dsphere" });
cookProfileSchema.index({ storeHandle: 1 });

export default mongoose.model("CookProfile", cookProfileSchema);
