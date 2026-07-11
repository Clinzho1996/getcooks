// models/Meal.js - Updated for cook-centric products
import mongoose from "mongoose";

const mealSchema = new mongoose.Schema(
	{
		cookId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},

		// Product Information
		name: { type: String, required: true },
		category: { type: String, required: true },
		whatsIncluded: { type: String, required: true },

		// Pricing
		unitType: {
			type: String,
			enum: [
				"per_litre",
				"per_plate",
				"per_pack",
				"per_bowl",
				"per_tray",
				"per_piece",
				"per_dozen",
				"per_bottle",
				"per_portion",
				"per_cup",
			],
			required: true,
		},
		price: { type: Number, required: true }, // Base price
		customerPrice: { type: Number, required: true }, // Price + fees

		// Add-ons
		addOns: [
			{
				name: { type: String, required: true },
				price: { type: Number, required: true },
			},
		],

		// Images
		images: [
			{
				url: String,
				publicId: String,
			},
		],

		// Availability
		isAvailable: { type: Boolean, default: true },
		isAlwaysAvailable: { type: Boolean, default: false },

		// Statistics
		ordersCount: { type: Number, default: 0 },
		rating: { type: Number, default: 0 },

		// Status
		status: {
			type: String,
			enum: ["active", "inactive", "out_of_stock"],
			default: "active",
		},
	},
	{ timestamps: true },
);

// Index for cook lookups
mealSchema.index({ cookId: 1 });

export default mongoose.model("Meal", mealSchema);
