// models/Review.js

import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
	{
		targetId: {
			type: mongoose.Schema.Types.ObjectId,
			required: true,
			refPath: "targetType",
		},
		targetType: {
			type: String,
			enum: ["cook", "meal"],
			required: true,
		},
		// ✅ Store the user ID of the cook for order lookups
		cookUserId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			index: true,
		},
		rating: {
			type: Number,
			required: true,
			min: 1,
			max: 5,
		},
		comment: {
			type: String,
			default: "",
		},
		customerName: {
			type: String,
			required: true,
		},
		customerPhone: {
			type: String,
			required: true,
			index: true,
		},
	},
	{ timestamps: true },
);

// Indexes
reviewSchema.index({ targetId: 1, customerPhone: 1 }, { unique: true });
reviewSchema.index({ targetId: 1, targetType: 1 });

export default mongoose.model("Review", reviewSchema);
