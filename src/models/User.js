// models/User.js - Fixed

import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
	{
		email: {
			type: String,
			unique: true,
			lowercase: true,
			trim: true,
		},
		fullName: String,
		phone: String,
		role: {
			type: String,
			enum: [
				"user",
				"admin",
				"cook",
				"operations agent",
				"operations manager",
				"customer support",
			],
			default: "user",
		},
		isCook: { type: Boolean, default: false },

		// ✅ Keep unique: true here, remove the schema.index() below
		firebaseUid: { type: String, unique: true, sparse: true },
		appleUserId: { type: String, unique: true, sparse: true },
		provider: {
			type: String,
			enum: ["email", "google.com", "apple.com", "facebook.com"],
			default: "email",
		},

		bio: String,
		profileImage: Object,
		coverImage: Object,
		location: {
			type: {
				type: String,
				enum: ["Point"],
			},
			coordinates: {
				type: [Number],
			},
			address: String,
			state: String,
			region: String,
		},

		referralCode: { type: String, unique: true, sparse: true },
		referredBy: { type: mongoose.Types.ObjectId, ref: "User", default: null },
		savedCooks: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

		pushTokens: {
			type: [
				{
					token: { type: String, required: true },
					platform: { type: String, enum: ["ios", "android"], required: true },
					deviceId: { type: mongoose.Schema.Types.Mixed, default: null },
					lastUsed: { type: Date, default: Date.now },
					createdAt: { type: Date, default: Date.now },
				},
			],
			default: [],
		},

		notes: {
			type: [
				{
					note: String,
					createdAt: { type: Date, default: Date.now },
				},
			],
			default: [],
		},
		zone: { type: String },
		notificationSettings: {
			push_enabled: { type: Boolean, default: true },
			email_enabled: { type: Boolean, default: true },
			transactions: { type: Boolean, default: true },
			promotions: { type: Boolean, default: false },
		},
		isVerified: { type: Boolean, default: false },
		favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

		password: {
			type: String,
			required: function () {
				return this.role === "admin";
			},
			select: false,
		},

		status: {
			type: String,
			enum: ["active", "inactive", "suspended"],
			default: "active",
		},

		isSuspended: { type: Boolean, default: false },
		suspensionReason: { type: String, default: null },
		suspensionNote: { type: String, default: null },
		suspendedAt: { type: Date, default: null },
		suspendedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},
		reactivatedAt: { type: Date, default: null },
		reactivatedBy: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			default: null,
		},

		lastLoginAt: { type: Date },
	},
	{ timestamps: true },
);

// ✅ Remove these duplicate index declarations since unique: true is already set above
// userSchema.index({ firebaseUid: 1 }, { unique: true, sparse: true });
// userSchema.index({ appleUserId: 1 }, { unique: true, sparse: true });

// Keep only the geospatial index
userSchema.index({ location: "2dsphere" });

export default mongoose.model("User", userSchema);
