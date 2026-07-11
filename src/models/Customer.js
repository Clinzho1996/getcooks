// models/Customer.js - New model for cook's customers
import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
	{
		cookId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		fullName: { type: String, required: true },
		phoneNumber: { type: String, required: true },
		email: { type: String },
		notes: { type: String },

		// Statistics
		ordersCount: { type: Number, default: 0 },
		totalSpent: { type: Number, default: 0 },
		lastOrderDate: { type: Date },

		// Status
		isActive: { type: Boolean, default: true },
	},
	{ timestamps: true },
);

// Index for cook lookups
customerSchema.index({ cookId: 1 });
customerSchema.index({ phoneNumber: 1, cookId: 1 }, { unique: true });

export default mongoose.model("Customer", customerSchema);
