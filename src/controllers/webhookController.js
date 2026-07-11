import crypto from "crypto";
import { getIO } from "../config/socket.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";

export const paystackWebhook = async (req, res) => {
	try {
		// 1️⃣ Verify signature
		const hash = crypto
			.createHmac("sha512", process.env.PAYSTACK_SECRET)
			.update(JSON.stringify(req.body))
			.digest("hex");

		if (hash !== req.headers["x-paystack-signature"]) {
			console.error("❌ Invalid Paystack signature");
			return res.sendStatus(401);
		}

		const event = req.body;

		// 🔍 DEBUG (IMPORTANT — remove later)
		console.log("🔥 PAYSTACK EVENT:", JSON.stringify(event.data, null, 2));

		// =========================
		// ✅ PAYMENT SUCCESS
		// =========================
		if (event.event === "charge.success") {
			const data = event.data;

			let order = null;

			// ✅ 1. PRIORITY: metadata (MOST RELIABLE)
			if (data.metadata?.orderId) {
				order = await Order.findById(data.metadata.orderId);
			}

			// ✅ 2. FALLBACK: reference
			if (!order) {
				const reference = data.reference || data.trxref;

				order = await Order.findOne({
					paymentReference: reference,
				});
			}

			// ❌ Not found
			if (!order) {
				console.error("❌ Order not found in webhook", {
					reference: data.reference,
					metadata: data.metadata,
				});
				return res.sendStatus(200);
			}

			// ✅ Idempotency (VERY IMPORTANT)
			if (order.paymentStatus === "paid") {
				return res.sendStatus(200);
			}

			// ✅ Update order
			order.paymentStatus = "paid";
			order.status = "confirmed";
			order.paymentReference = data.reference;

			await order.save();

			// ✅ Credit cook
			const cook = await User.findById(order.cookId);

			const commissionRate = 0.1;
			const cookAmount = order.totalAmount * (1 - commissionRate);

			cook.walletBalance += cookAmount;
			await cook.save();

			// ✅ Log transaction
			await WalletTransaction.create({
				cookId: cook._id,
				type: "credit",
				amount: cookAmount,
				reference: order._id.toString(),
				description: "Order payment",
			});

			// ✅ Realtime update
			const io = getIO();
			io.to(`user_${order.userId}`).emit("order_update", order);

			console.log("✅ Payment processed:", order._id);
		}

		// =========================
		// 🔁 REFUND HANDLING
		// =========================
		if (event.event === "refund.processed") {
			const data = event.data;

			let order = null;

			// ✅ Try metadata first
			if (data.metadata?.orderId) {
				order = await Order.findById(data.metadata.orderId);
			}

			// ✅ Fallback to transaction reference
			if (!order) {
				order = await Order.findOne({
					paymentReference: data.transaction,
				});
			}

			if (!order) {
				console.error("❌ Refund order not found");
				return res.sendStatus(200);
			}

			if (order.paymentStatus === "refunded") {
				return res.sendStatus(200);
			}

			order.paymentStatus = "refunded";
			order.status = "cancelled";
			order.refundReference = data.reference;

			await order.save();

			// ✅ Reverse wallet safely
			const cook = await User.findById(order.cookId);

			const commissionRate = 0.1;
			const refundAmount = order.totalAmount * (1 - commissionRate);

			cook.walletBalance = Math.max(cook.walletBalance - refundAmount, 0);

			await cook.save();

			await WalletTransaction.create({
				cookId: cook._id,
				type: "debit",
				amount: refundAmount,
				reference: order._id.toString(),
				description: "Refund reversal",
			});

			const io = getIO();
			io.to(`user_${order.userId}`).emit("order_update", order);

			console.log("🔁 Refund processed:", order._id);
		}

		return res.sendStatus(200);
	} catch (error) {
		console.error("❌ Webhook error:", error.message);
		return res.sendStatus(500);
	}
};

export const paymentWebhook = async (req, res) => {
	const { orderId, amount } = req.body;

	const order = await Order.findById(orderId).populate("cook");

	if (!order) return res.sendStatus(404);

	if (order.paymentStatus === "paid") return res.sendStatus(200);

	order.paymentStatus = "paid";
	await order.save();

	// Commission example 10%

	const commission = amount * 0.1;

	const cookAmount = amount - commission;

	// Credit cook wallet

	await Wallet.findOneAndUpdate(
		{ user: order.cook._id },
		{
			$inc: {
				balance: cookAmount,
			},
		},
		{ upsert: true },
	);

	res.sendStatus(200);
};
