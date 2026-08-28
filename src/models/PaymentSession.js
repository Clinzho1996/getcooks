// models/PaymentSession.js
import mongoose from "mongoose";

const paymentSessionSchema = new mongoose.Schema({
	sessionType: {
		type: String,
		enum: ["customer_order", "cart_order"],
		required: true,
	},
	cookId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "User",
		required: true,
	},
	customerId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Customer",
		required: true,
	},
	customerName: String,
	customerPhone: String,
	customerEmail: String,
	customerNote: String,
	deliveryType: {
		type: String,
		enum: ["pickup", "delivery"],
		default: "pickup",
	},
	deliveryAddress: String,
	deliveryFee: Number,
	readyDate: Date,
	readyTime: String,
	pickupWindow: {
		from: String,
		to: String,
	},
	foodRequest: String,
	items: Array,
	subtotal: Number,
	serviceFee: Number,
	paystackFee: Number,
	totalAmount: Number,
	paymentReference: String,
	paymentLink: String,
	status: {
		type: String,
		enum: ["pending", "completed", "declined"],
		default: "pending",
	},
	declineReason: String,
	orderId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Order",
	},
	sessionId: String,
	createdAt: {
		type: Date,
		default: Date.now,
	},
});

// Auto-delete pending sessions after 30 minutes
paymentSessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: 1800 });

export default mongoose.model("PaymentSession", paymentSessionSchema);
