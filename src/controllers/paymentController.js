// controllers/paymentController.js
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushService.js";
import { createAdminNotification } from "../utils/adminNotification.js";
import { sendDeliveryOTPEmail } from "../utils/emailService.js";

// Handle successful payment
export const handleSuccessfulPayment = async (data) => {
	try {
		let order = null;

		// ✅ 1. FIRST: Use metadata (MOST RELIABLE)
		const orderId = data.metadata?.orderId;

		if (orderId) {
			order = await Order.findById(orderId);
		}

		// ✅ 2. FALLBACK: Use reference
		if (!order) {
			order = await Order.findOne({
				paymentReference: data.reference,
			});
		}

		// ❌ If still not found → log it
		if (!order) {
			console.error("❌ Webhook: Order not found", {
				reference: data.reference,
				metadata: data.metadata,
			});
			return;
		}

		// ✅ Prevent double processing
		if (order.paymentStatus === "paid") {
			console.log(`⏭️ Order ${order._id} already marked as paid`);
			return;
		}

		// 🆕 GENERATE DELIVERY OTP (6-digit, NO EXPIRY)
		const deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();

		console.log(`🔐 Generating OTP ${deliveryOtp} for order ${order._id}`);

		// ✅ Update order with OTP
		order.paymentStatus = "paid";
		order.status = "confirmed";
		order.paymentReference = data.reference;
		order.deliveryOtp = deliveryOtp; // Set the OTP
		order.otpGeneratedAt = new Date(); // Set generation time

		await order.save();

		console.log(`✅ Order updated with OTP: ${order.deliveryOtp}`);
		console.log(`✅ OTP Generated At: ${order.otpGeneratedAt}`);
		console.log(`✅ Payment applied via webhook: ${order._id}`);
		console.log(`👤 Customer ID: ${order.userId}`);

		// 📧 Send OTP to user via email
		try {
			const user = await User.findById(order.userId);
			if (user && user.email) {
				const emailHtml = `
					<h2>Order Confirmed! 🎉</h2>
					<p>Your order #${order._id.toString().slice(-6)} has been confirmed.</p>
					<p><strong>Your Delivery OTP is: ${deliveryOtp}</strong></p>
					<p>⚠️ Keep this OTP safe. You'll need to share it with the cook/delivery person when you receive your order.</p>
					<p>This OTP does not expire and is valid until your order is delivered.</p>
					<h3>Order Summary:</h3>
					<p><strong>Total Amount:</strong> ₦${order.totalAmount.toFixed(2)}</p>
					<p><strong>Delivery Type:</strong> ${order.deliveryType}</p>
					<p><strong>Order ID:</strong> ${order._id}</p>
					<small>Thank you for choosing GetAMeal!</small>
				`;

				await sendDeliveryOTPEmail(user.email, deliveryOtp, emailHtml);
				console.log(`✅ OTP email sent to ${user.email}`);
			}
		} catch (emailError) {
			console.error(`❌ Failed to send OTP email:`, emailError.message);
		}

		// ✅ SEND PUSH NOTIFICATION AFTER ORDER IS SAVED
		try {
			console.log(`📱 Attempting to send push to customer: ${order.userId}`);

			const pushResult = await sendPushToUser(
				order.userId,
				"🎫 Payment Successful - Your Delivery OTP",
				`Your payment of ₦${order.totalAmount.toFixed(2)} is confirmed! Your delivery OTP is: ${deliveryOtp}. Keep it safe!`,
				{
					orderId: order._id.toString(),
					amount: order.totalAmount,
					type: "payment_success",
					otp: deliveryOtp,
				},
			);

			if (pushResult.success) {
				console.log(
					`✅ Push notification sent to customer for order ${order._id}`,
				);
				console.log(
					`📊 Sent to ${pushResult.sent} device(s), Failed: ${pushResult.failed}`,
				);
			} else {
				console.warn(
					`⚠️ Push notification failed for order ${order._id}: ${pushResult.message}`,
				);
				if (pushResult.errors) {
					console.error("Push errors:", pushResult.errors);
				}
			}

			// Also create in-app notification
			await sendNotification({
				userId: order.userId,
				title: "Payment Successful - Order Confirmed",
				body: `Your payment of ₦${order.totalAmount.toFixed(2)} is confirmed! Your delivery OTP is: ${deliveryOtp}`,
				type: "payment_success",
				data: {
					orderId: order._id.toString(),
					amount: order.totalAmount,
					otp: deliveryOtp,
				},
			});
		} catch (pushError) {
			// Don't let push failure break the payment flow
			console.error(
				`❌ Push notification error for order ${order._id}:`,
				pushError.message,
			);
			console.error("Push error details:", pushError);
		}

		// Send notification to COOK with OTP
		try {
			const cook = await User.findById(order.cookId);
			if (cook) {
				await sendPushToUser(
					order.cookId,
					"🆕 New Paid Order! 💰",
					`New order #${order._id.toString().slice(-6)} for ₦${order.totalAmount.toFixed(2)}. Customer OTP: ${deliveryOtp}`,
					{
						type: "new_paid_order",
						orderId: order._id.toString(),
						amount: order.totalAmount.toString(),
						otp: deliveryOtp,
					},
				);
				console.log(`✅ Push notification sent to cook for order ${order._id}`);
			}
		} catch (cookPushError) {
			console.error(`❌ Failed to send push to cook:`, cookPushError.message);
		}

		// Send admin notification
		try {
			await createAdminNotification({
				title: "💰 New Paid Order",
				body: `Order #${order._id.toString().slice(-6)}: ₦${order.totalAmount.toFixed(2)} payment completed. OTP: ${deliveryOtp}`,
				type: "order",
				data: { orderId: order._id, otp: deliveryOtp },
			});
			console.log(`✅ Admin notification sent for order ${order._id}`);
		} catch (adminError) {
			console.error(
				`❌ Failed to send admin notification:`,
				adminError.message,
			);
		}

		return { success: true, order, otp: deliveryOtp };
	} catch (error) {
		console.error("Webhook processing error:", error.message);
		console.error("Full error:", error);
		throw error;
	}
};

// Handle refund
export const handleRefund = async (data) => {
	try {
		const order = await Order.findOne({
			paymentReference: data.transaction_reference,
		});

		if (!order) throw new Error("Order not found");

		order.paymentStatus = "refunded";
		order.status = "cancelled";
		order.deliveryOtp = null; // Clear OTP on refund
		order.otpGeneratedAt = null;
		await order.save();

		// Update cook's wallet
		const cook = await User.findById(order.cookId);
		if (cook) {
			cook.walletBalance = (cook.walletBalance || 0) - order.totalAmount;
			await cook.save();

			await WalletTransaction.create({
				userId: cook._id,
				type: "debit",
				amount: order.totalAmount,
				reason: `Refund for order ${order._id}`,
				reference: order._id.toString(),
			});

			console.log(`✅ Cook ${cook._id} debited: ${order.totalAmount}`);
		}

		// Send push notification to customer
		try {
			await sendPushToUser(
				order.userId,
				"Payment Refunded",
				`Your payment for order ${order._id} has been refunded.`,
				{ orderId: order._id.toString() },
			);

			// Also create in-app notification
			await sendNotification({
				userId: order.userId,
				title: "Payment Refunded",
				body: `Your payment for order ${order._id} has been refunded.`,
				type: "payment_refund",
				data: { orderId: order._id.toString() },
			});
		} catch (pushError) {
			console.error(
				`❌ Push notification error for refund:`,
				pushError.message,
			);
		}

		console.log(`✅ Refund processed for order ${order._id}`);
	} catch (error) {
		console.error("Refund processing error:", error.message);
		throw error;
	}
};
