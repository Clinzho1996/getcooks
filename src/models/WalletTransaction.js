// models/WalletTransaction.js
import mongoose from "mongoose";

const walletTransactionSchema = new mongoose.Schema(
	{
		cookId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "User",
			required: true,
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
		},
		description: {
			type: String,
			default: "",
		},
		status: {
			type: String,
			enum: ["pending", "success", "failed"],
			default: "success",
		},
	},
	{ timestamps: true },
);

walletTransactionSchema.index({ cookId: 1 });
walletTransactionSchema.index({ reference: 1 });

export default mongoose.model("WalletTransaction", walletTransactionSchema);
