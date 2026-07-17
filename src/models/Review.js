// models/Review.js - Updated

import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
	{
		// ✅ Make user optional (for backward compatibility)
		user: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: false, // Changed from true to false
			index: true,
		},
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
		// ✅ Customer info - no user reference needed
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

// Ensure one review per customer per target
reviewSchema.index({ targetId: 1, customerPhone: 1 }, { unique: true });
reviewSchema.index({ targetId: 1, targetType: 1 });

export default mongoose.model("Review", reviewSchema);
