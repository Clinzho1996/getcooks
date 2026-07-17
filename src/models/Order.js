// models/Order.js - Clean version

import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
	{
		cookId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
		},
		customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },

		customerName: { type: String, required: true },
		customerPhone: { type: String, required: true },
		customerEmail: { type: String },
		customerNote: { type: String },

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

		customOrderTitle: { type: String },
		customOrderDescription: { type: String },

		deliveryType: {
			type: String,
			enum: ["pickup", "delivery"],
			required: true,
		},
		deliveryFee: { type: Number, default: 0 },

		deliveryAddress: { type: String, required: true },
		pickupWindow: {
			from: String,
			to: String,
		},

		readyDate: { type: Date, required: true },
		readyTime: { type: String },

		subtotal: { type: Number, required: true },
		serviceFee: { type: Number, required: true },
		totalAmount: { type: Number, required: true },

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

		status: {
			type: String,
			enum: [
				"pending",
				"confirmed",
				"preparing",
				"ready",
				"out_for_delivery",
				"picked_up",
				"delivered",
				"cancelled",
			],
			default: "pending",
		},

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
