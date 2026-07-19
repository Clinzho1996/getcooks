// models/CookProfile.js - Add pickupEnabled

import mongoose from "mongoose";

const cookProfileSchema = new mongoose.Schema(
	{
		userId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			unique: true,
		},

		storeName: { type: String, required: true },
		storeHandle: {
			type: String,
			required: true,
			unique: true,
			lowercase: true,
		},
		storeLink: { type: String, required: true },
		storeDescription: { type: String, maxlength: 500 },

		phone: { type: String, required: true },
		email: { type: String, required: true },

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

		pickupWindow: {
			from: { type: String, required: true },
			to: { type: String, required: true },
		},
		noteForCustomers: { type: String, maxlength: 1000 },
		// ✅ Add pickupEnabled
		pickupEnabled: { type: Boolean, default: true },
		deliveryEnabled: { type: Boolean, default: false },
		deliveryFee: { type: Number, default: 0 },
		preparationDays: { type: Number, default: 1, min: 1 },

		profileImage: { type: String },
		coverImage: { type: String },

		termsAccepted: { type: Boolean, default: false },
		termsAcceptedAt: { type: Date },

		isApproved: { type: Boolean, default: true },
		isAvailable: { type: Boolean, default: true },
		isSuspended: { type: Boolean, default: false },
		suspensionReason: { type: String },
		suspensionNote: { type: String },
		suspendedAt: { type: Date },
		suspendedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

		rating: { type: Number, default: 0 },
		reviewsCount: { type: Number, default: 0 },
		fees: {
			addFeesToCustomer: {
				type: Boolean,
				default: true,
			},
		},

		ordersCount: { type: Number, default: 0 },
		walletBalance: { type: Number, default: 0 },
		viewsThisWeek: { type: Number, default: 0 },
		viewsHistory: [
			{
				date: { type: Date, default: Date.now },
				count: { type: Number, default: 0 },
			},
		],

		bankDetails: {
			bankName: String,
			bankCode: String,
			accountNumber: String,
			accountName: String,
			recipientCode: String,
			subaccountCode: String,
		},
	},
	{ timestamps: true },
);

// Geospatial index
cookProfileSchema.index({ location: "2dsphere" });

export default mongoose.model("CookProfile", cookProfileSchema);
