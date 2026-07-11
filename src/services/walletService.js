import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const creditCookWallet = async (order) => {
	const cook = await User.findById(order.cookId);

	cook.walletBalance += order.totalAmount;
	await cook.save();

	await WalletTransaction.create({
		cookId: cook._id,
		type: "credit",
		amount: order.totalAmount,
		reference: order._id,
	});
};

export const handleRefund = async (data) => {
	// Paystack sends transaction reference
	const order = await Order.findOne({
		paymentReference: data.transaction_reference,
	});

	if (!order) return;

	// Prevent double processing
	if (order.paymentStatus === "refunded") return;

	order.paymentStatus = "refunded";
	order.status = "cancelled";

	await order.save();

	// 🔹 Reverse cook earnings SAFELY
	const cook = await User.findById(order.cookId);

	if (cook.walletBalance >= order.totalAmount) {
		cook.walletBalance -= order.totalAmount;
	} else {
		// handle deficit (important for real system)
		cook.walletBalance = 0;
	}

	await cook.save();

	await WalletTransaction.create({
		cookId: cook._id,
		type: "debit",
		amount: order.totalAmount,
		reference: order._id,
		description: "Refund reversal",
	});
};
