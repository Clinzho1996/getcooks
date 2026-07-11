import { paystack } from "../config/paystack.js";
import Order from "../models/Order.js";
import { sendNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushService.js";

// GET /api/admin/payments/stats
export const getPaymentStats = async (req, res) => {
	try {
		const { date } = req.query;

		const targetDate = date ? new Date(date) : new Date();

		const start = new Date(targetDate);
		start.setHours(0, 0, 0, 0);

		const end = new Date(targetDate);
		end.setHours(23, 59, 59, 999);

		const yesterdayStart = new Date(start);
		yesterdayStart.setDate(start.getDate() - 1);

		const yesterdayEnd = new Date(end);
		yesterdayEnd.setDate(end.getDate() - 1);

		// Today
		const todayOrders = await Order.find({
			createdAt: { $gte: start, $lte: end },
		});

		// Yesterday
		const yesterdayOrders = await Order.find({
			createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
		});

		const calcStats = (orders) => ({
			revenue: orders
				.filter((o) => o.paymentStatus === "paid")
				.reduce((sum, o) => sum + (o.totalAmount || 0), 0),

			pending: orders.filter((o) => o.paymentStatus === "pending").length,
			failed: orders.filter((o) => o.paymentStatus === "failed").length,
			refunded: orders.filter((o) => o.paymentStatus === "refunded").length,
		});

		const today = calcStats(todayOrders);
		const yesterday = calcStats(yesterdayOrders);

		const percentChange = (todayVal, yesterdayVal) => {
			if (yesterdayVal === 0) return 0;
			return (((todayVal - yesterdayVal) / yesterdayVal) * 100).toFixed(2);
		};

		res.status(200).json({
			totalRevenue: today.revenue,
			revenueChange: percentChange(today.revenue, yesterday.revenue),

			pendingPayments: today.pending,
			pendingChange: percentChange(today.pending, yesterday.pending),

			failedPayments: today.failed,
			failedChange: percentChange(today.failed, yesterday.failed),

			refundedPayments: today.refunded,
			refundedChange: percentChange(today.refunded, yesterday.refunded),
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// GET /api/admin/payments
export const getPayments = async (req, res) => {
	try {
		const {
			status, // paid | pending | failed | refunded
			method, // card | transfer | etc
			sortBy, // newest | oldest | highest | lowest
			dateFrom,
			dateTo,
		} = req.query;

		const filter = {};

		if (status) {
			filter.paymentStatus = status;
		}

		if (method) {
			filter.paymentMethod = method;
		}

		if (dateFrom || dateTo) {
			filter.createdAt = {};
			if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
			if (dateTo) filter.createdAt.$lte = new Date(dateTo);
		}

		// Sorting
		let sort = {};
		switch (sortBy) {
			case "newest":
				sort.createdAt = -1;
				break;
			case "oldest":
				sort.createdAt = 1;
				break;
			case "highest":
				sort.totalAmount = -1;
				break;
			case "lowest":
				sort.totalAmount = 1;
				break;
			default:
				sort.createdAt = -1;
		}

		const payments = await Order.find(filter)
			.sort(sort)
			.populate("userId", "fullName email")
			.populate("cookId", "cookName");

		res.status(200).json({ payments });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// GET /api/admin/payments/:id
export const getPaymentById = async (req, res) => {
	try {
		const payment = await Order.findById(req.params.id)
			.populate("userId", "fullName email phone")
			.populate("cookId", "cookName");

		if (!payment) {
			return res.status(404).json({ message: "Payment not found" });
		}

		res.status(200).json({ payment });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// POST /api/admin/payments/:id/refund
export const refundPayment = async (req, res) => {
	try {
		const { reason } = req.body;

		const order = await Order.findById(req.params.id);

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		if (order.paymentStatus !== "paid") {
			return res
				.status(400)
				.json({ message: "Only paid orders can be refunded" });
		}

		if (!order.paymentReference) {
			return res.status(400).json({ message: "No payment reference found" });
		}

		// Call Paystack refund API
		const response = await paystack.post("/refund", {
			transaction: order.paymentReference,
			reason: reason || "Admin initiated refund",
		});

		await sendNotification({
			userId: order.customerId,
			title: "Refund Initiated",
			body: `Your refund for order ${order._id} has been initiated. Reason: ${reason}`,
			type: "refund_initiated",
			data: { orderId: order._id.toString(), amount: order.totalAmount },
		});

		await sendPushToUser(
			order.customerId,
			"Refund Initiated",
			`Your refund for order ${order._id} has been initiated. Reason: ${reason}`,
			{ orderId: order._id.toString(), amount: order.totalAmount },
		);

		// Update order
		order.paymentStatus = "refunded";
		order.refundReason = reason;
		order.refundedAt = new Date();

		await order.save();

		res.status(200).json({
			message: "Refund initiated successfully",
			data: response.data,
		});
	} catch (error) {
		console.error(error.response?.data || error.message);
		res.status(500).json({
			message: "Refund failed",
			error: error.response?.data || error.message,
		});
	}
};
