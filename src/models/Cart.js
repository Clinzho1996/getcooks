// models/Cart.js - Public Cart
import mongoose from "mongoose";

const cartItemSchema = new mongoose.Schema({
	productId: {
		type: mongoose.Schema.Types.ObjectId,
		ref: "Meal",
		required: true,
	},
	name: { type: String, required: true },
	price: { type: Number, required: true },
	customerPrice: { type: Number },
	quantity: { type: Number, default: 1, min: 1 },
	addOns: [
		{
			name: String,
			price: Number,
		},
	],
	image: { type: String },
});

const cartSchema = new mongoose.Schema(
	{
		sessionId: {
			type: String,
			required: true,
			unique: true,
			index: true,
		},
		items: [cartItemSchema],
		subtotal: { type: Number, default: 0 },
		expiresAt: {
			type: Date,
			default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
		},
	},
	{ timestamps: true },
);

// Auto-expire old carts
cartSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Cart", cartSchema);
