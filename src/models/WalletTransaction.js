import mongoose from "mongoose";

const walletSchema = new mongoose.Schema(
	{
		cookId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
			index: true,
		},
		type: {
			type: String,
			enum: ["credit", "debit", "payout"],
			required: true,
		},
		amount: {
			type: Number,
			required: true,
		},
		reference: {
			type: String,
			required: true,
			index: true,
		},
		status: {
			type: String,
			default: "success",
			enum: ["pending", "success", "failed"],
		},
		description: {
			type: String,
			default: "",
		},
		orderId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Order",
		},
		commission: {
			type: Number,
			default: 0,
		},
		balanceAfter: {
			type: Number,
			default: 0,
		},
	},
	{ timestamps: true },
);

// Add compound index for better query performance
walletSchema.index({ cookId: 1, createdAt: -1 });

export default mongoose.model("WalletTransaction", walletSchema);
