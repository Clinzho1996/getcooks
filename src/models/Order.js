// models/Order.js - Updated for cook-centric orders
import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
	{
		cookId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },

		// Customer Info (for non-registered customers)
		customerName: { type: String, required: true },
		customerPhone: { type: String, required: true },
		customerEmail: { type: String },
		customerNote: { type: String },

		// Order Details
		orderType: {
			type: String,
			enum: ["product_order", "custom_order"],
			default: "product_order",
		},
		items: [
			{
				productId: { type: mongoose.Schema.Types.ObjectId, ref: "Meal" },
				name: { type: String, required: true },
				quantity: { type: Number, required: true, default: 1 },
				price: { type: Number, required: true },
				addOns: [
					{
						name: String,
						price: Number,
					},
				],
				subtotal: { type: Number, required: true },
			},
		],

		// Custom Order Details
		customOrderTitle: { type: String },
		customOrderDescription: { type: String },

		// Fulfillment
		deliveryType: {
			type: String,
			enum: ["pickup", "delivery"],
			required: true,
		},
		deliveryFee: { type: Number, default: 0 },
		pickupWindow: {
			from: String,
			to: String,
		},

		// Timing
		readyDate: { type: Date, required: true },
		readyTime: { type: String },

		// Financials
		subtotal: { type: Number, required: true },
		serviceFee: { type: Number, required: true },
		totalAmount: { type: Number, required: true },

		// Payment
		paymentMethod: {
			type: String,
			enum: ["paystack", "bank_transfer", "cash", "wallet"],
			default: "paystack",
		},
		paymentStatus: {
			type: String,
			enum: ["pending", "paid", "failed", "refunded"],
			default: "pending",
		},
		paymentReference: String,
		paymentLink: String,

		// Status
		status: {
			type: String,
			enum: [
				"pending",
				"confirmed",
				"preparing",
				"ready",
				"picked_up",
				"delivered",
				"cancelled",
			],
			default: "pending",
		},

		// Notes
		sellerNote: { type: String },
		customerNote: { type: String },
	},
	{ timestamps: true },
);

// Indexes
orderSchema.index({ cookId: 1 });
orderSchema.index({ customerId: 1 });
orderSchema.index({ status: 1 });
orderSchema.index({ createdAt: -1 });

export default mongoose.model("Order", orderSchema);
