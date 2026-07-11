import mongoose from "mongoose";

const pendingTransferSchema = new mongoose.Schema({
	cookId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
	transferCode: { type: String, required: true, unique: true },
	amount: { type: Number, required: true },
	status: { type: String, default: "pending_otp" }, // pending_otp, completed
	createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("PendingTransfer", pendingTransferSchema);
