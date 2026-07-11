import axios from "axios";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import CookProfile from "../models/CookProfile.js";
import Notification from "../models/Notification.js";
import Order from "../models/Order.js";
import Review from "../models/Review.js";
import Session from "../models/Session.js"; // tracks user login sessions
import User from "../models/User.js";
import Zone from "../models/Zone.js";
import { sendNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushService.js";
import { getResendInstance } from "../utils/emailService.js";
import { getDateRanges } from "../utils/getDateRange.js";

export const getOverviewStats = async (req, res) => {
	try {
		const { start, end, zone } = req.query;

		const { currentStart, currentEnd, prevStart, prevEnd } = getDateRanges(
			start,
			end,
		);

		// FILTERS
		const baseMatch = {
			createdAt: { $gte: currentStart, $lte: currentEnd },
		};

		const prevMatch = {
			createdAt: { $gte: prevStart, $lte: prevEnd },
		};

		if (zone) {
			baseMatch["deliveryAddress.region"] = zone;
			prevMatch["deliveryAddress.region"] = zone;
		}

		// =========================
		// CURRENT METRICS
		// =========================
		const [
			totalOrders,
			completedOrders,
			cancelledOrders,
			refundedOrders,
			gmvData,
		] = await Promise.all([
			Order.countDocuments(baseMatch),

			Order.countDocuments({
				...baseMatch,
				status: { $in: ["delivered", "picked_up"] },
			}),

			Order.countDocuments({
				...baseMatch,
				status: "cancelled",
			}),

			Order.countDocuments({
				...baseMatch,
				paymentStatus: "refunded",
			}),

			Order.aggregate([
				{ $match: baseMatch },
				{
					$group: {
						_id: null,
						total: { $sum: "$totalAmount" },
					},
				},
			]),
		]);

		const gmv = gmvData[0]?.total || 0;

		// =========================
		// PREVIOUS METRICS
		// =========================
		const [prevTotalOrders, prevCancelled, prevRefunded, prevGmvData] =
			await Promise.all([
				Order.countDocuments(prevMatch),

				Order.countDocuments({
					...prevMatch,
					status: "cancelled",
				}),

				Order.countDocuments({
					...prevMatch,
					paymentStatus: "refunded",
				}),

				Order.aggregate([
					{ $match: prevMatch },
					{
						$group: {
							_id: null,
							total: { $sum: "$totalAmount" },
						},
					},
				]),
			]);

		const prevGmv = prevGmvData[0]?.total || 0;

		// =========================
		// ACTIVE COOKS
		// =========================
		const activeCooks = await Order.distinct("cookId", baseMatch);
		const prevActiveCooks = await Order.distinct("cookId", prevMatch);

		// =========================
		// % CHANGE FUNCTION
		// =========================
		const calcChange = (current, prev) => {
			if (prev === 0) return current === 0 ? 0 : 100;
			return ((current - prev) / prev) * 100;
		};

		res.json({
			activeCooks: {
				value: activeCooks.length,
				change: calcChange(activeCooks.length, prevActiveCooks.length),
			},
			totalOrders: {
				value: totalOrders,
				change: calcChange(totalOrders, prevTotalOrders),
			},
			gmv: {
				value: gmv,
				change: calcChange(gmv, prevGmv),
			},
			cancellations: {
				value: cancelledOrders,
				change: calcChange(cancelledOrders, prevCancelled),
			},
			refunds: {
				value: refundedOrders,
				change: calcChange(refundedOrders, prevRefunded),
			},
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getOrderAnalytics = async (req, res) => {
	try {
		const { zone } = req.query;

		const now = new Date();

		// Today range
		const startOfToday = new Date();
		startOfToday.setHours(0, 0, 0, 0);

		const endOfToday = new Date();
		endOfToday.setHours(23, 59, 59, 999);

		// Base filter
		const baseFilter = {};
		if (zone) {
			baseFilter["deliveryAddress.region"] = zone;
		}

		// At risk threshold (e.g., 45 mins)
		const atRiskThreshold = new Date(Date.now() - 45 * 60 * 1000);

		const [
			totalOrders,
			ordersToday,
			activeOrders,
			completedOrders,
			cancelledOrders,
			atRiskOrders,
		] = await Promise.all([
			// Total orders
			Order.countDocuments(baseFilter),

			// Orders today
			Order.countDocuments({
				...baseFilter,
				createdAt: { $gte: startOfToday, $lte: endOfToday },
			}),

			// Active orders (in progress)
			Order.countDocuments({
				...baseFilter,
				status: { $in: ["pending", "confirmed", "cooking", "ready"] },
			}),

			// Completed orders
			Order.countDocuments({
				...baseFilter,
				status: { $in: ["delivered", "picked_up"] },
			}),

			// Cancelled orders
			Order.countDocuments({
				...baseFilter,
				status: "cancelled",
			}),

			// At risk orders
			Order.countDocuments({
				...baseFilter,
				status: { $in: ["pending", "confirmed", "cooking"] },
				createdAt: { $lte: atRiskThreshold },
			}),
		]);

		res.status(200).json({
			totalOrders,
			ordersToday,
			activeOrders,
			completedOrders,
			cancelledOrders,
			atRiskOrders,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

export const getOrderChart = async (req, res) => {
	try {
		const { start, end, zone } = req.query;

		const match = {
			createdAt: { $gte: new Date(start), $lte: new Date(end) },
		};

		if (zone) {
			match["deliveryAddress.region"] = zone;
		}

		const data = await Order.aggregate([
			{ $match: match },
			{
				$group: {
					_id: {
						date: {
							$dateToString: {
								format: "%Y-%m-%d",
								date: "$createdAt",
							},
						},
						status: "$status",
					},
					count: { $sum: 1 },
				},
			},
			{
				$group: {
					_id: "$_id.date",
					data: {
						$push: {
							status: "$_id.status",
							count: "$count",
						},
					},
				},
			},
			{ $sort: { _id: 1 } },
		]);

		res.json(data);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getFulfillmentTime = async (req, res) => {
	try {
		const { start, end } = req.query;

		const data = await Order.aggregate([
			{
				$match: {
					status: { $in: ["delivered", "picked_up"] },
					createdAt: { $gte: new Date(start), $lte: new Date(end) },
				},
			},
			{
				$project: {
					duration: {
						$divide: [
							{ $subtract: ["$updatedAt", "$createdAt"] },
							1000 * 60, // minutes
						],
					},
				},
			},
			{
				$group: {
					_id: null,
					avgTime: { $avg: "$duration" },
				},
			},
		]);

		res.json({
			averageFulfillmentTime: data[0]?.avgTime || 0,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getSystemAlerts = async (req, res) => {
	try {
		const [lateOrders, paymentFailures, pendingPayouts] = await Promise.all([
			Order.countDocuments({
				status: { $in: ["cooking", "ready"] },
				createdAt: {
					$lte: new Date(Date.now() - 60 * 60 * 1000),
				},
			}),
			Order.countDocuments({
				paymentStatus: "pending",
			}),
			CookProfile.countDocuments({
				walletBalance: { $gt: 0 },
			}),
		]);

		res.json({
			lateOrders,
			paymentFailures,
			pendingPayouts,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getAllOrders = async (req, res) => {
	try {
		const { page = 1, limit = 10, status, zone, start, end } = req.query;

		const query = {};

		if (status) query.status = status;

		if (zone) {
			query["deliveryAddress.region"] = zone;
		}

		if (start && end) {
			query.createdAt = {
				$gte: new Date(start),
				$lte: new Date(end),
			};
		}

		const orders = await Order.find(query)
			.populate("userId") // return full user object
			.populate("cookId") // return full cook object
			.populate("mealItems.mealId") // return full meal object
			.sort({ createdAt: -1 })
			.skip((page - 1) * limit)
			.limit(Number(limit));

		const total = await Order.countDocuments(query);

		const formattedOrders = orders.map((order) => ({
			_id: order._id,
			user: order.userId, // full user object
			cook: order.cookId, // full cook object
			totalAmount: order.totalAmount,
			status: order.status,
			paymentStatus: order.paymentStatus,
			deliveryType: order.deliveryType,
			deliveryAddress: order.deliveryAddress,
			createdAt: order.createdAt,
			mealItems: order.mealItems.map((item) => ({
				mealId: item.mealId?._id,
				name: item.mealId?.name,
				images: item.mealId?.images || [],
				price: item.price,
				quantity: item.quantity,
				fullMeal: item.mealId, // full meal object
			})),
		}));

		res.json({
			page: Number(page),
			total,
			pages: Math.ceil(total / limit),
			orders: formattedOrders,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: error.message });
	}
};

export const getOrderById = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id)
			.populate("userId", "fullName email")
			.populate("cookId", "fullName email")
			.populate("mealItems.mealId", "name images price");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		// Transform mealItems to include only what you need
		const formattedMealItems = order.mealItems.map((item) => ({
			mealId: item.mealId?._id,
			name: item.mealId?.name,
			images: item.mealId?.images || [],
			price: item.price,
			quantity: item.quantity,
		}));

		const formattedOrder = {
			_id: order._id,
			user: order.userId,
			cook: order.cookId,
			totalAmount: order.totalAmount,
			status: order.status,
			paymentStatus: order.paymentStatus,
			deliveryType: order.deliveryType,
			deliveryAddress: order.deliveryAddress,
			note: order.note,
			mealItems: formattedMealItems,
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
		};

		res.status(200).json(formattedOrder);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: error.message });
	}
};

export const cancelOrder = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id);

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		if (order.status === "cancelled") {
			return res.status(400).json({ message: "Already cancelled" });
		}

		order.status = "cancelled";

		await sendNotification({
			userId: order.userId,
			title: "Order Cancelled",
			body: "Your order has been cancelled",
			type: "order",
			data: { orderId: order._id },
		});

		await sendPushToUser(
			order.userId,
			"Order cancelled",
			"Your order has been cancelled",
			{ orderId: order._id.toString() },
		);
		await order.save();

		res.json({ message: "Order cancelled successfully", order });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const issueRefund = async (req, res) => {
	try {
		const order = await Order.findById(req.params.id);

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		if (order.paymentStatus !== "paid") {
			return res.status(400).json({
				message: "Only paid orders can be refunded",
			});
		}

		// 🔹 Call Paystack Refund API
		const response = await axios.post(
			"https://api.paystack.co/refund",
			{
				transaction: order.paymentReference, // VERY IMPORTANT
				amount: order.totalAmount * 100, // in kobo
			},
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		// Save refund request reference
		order.refundReference = response.data.data.reference;
		order.refundStatus = "pending";
		await order.save();

		await sendNotification({
			userId: order.userId,
			title: "Order Cancelled",
			body: "Your order has been cancelled.",
			type: "order_cancelled",
			data: { orderId: order._id.toString() },
		});

		await sendPushToUser(
			order.userId,
			"Order Cancelled",
			"Your order has been cancelled.",
			{ orderId: order._id.toString() },
		);

		res.json({
			message: "Refund initiated. Awaiting confirmation.",
			data: response.data.data,
		});
	} catch (error) {
		res.status(500).json({
			message: error.response?.data || error.message,
		});
	}
};

export const getAtRiskOrders = async (req, res) => {
	try {
		const thresholdMinutes = 45;

		const orders = await Order.find({
			status: { $in: ["pending", "confirmed", "cooking"] },
			createdAt: {
				$lte: new Date(Date.now() - thresholdMinutes * 60 * 1000),
			},
		})
			.populate("userId", "fullName phone")
			.populate("cookId", "fullName phone");

		res.json(orders);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const getAllMainOrders = async (req, res) => {
	try {
		const { status, paymentStatus, dateFrom, dateTo, cookId } = req.query;

		// Build dynamic filter
		const filter = {};

		if (status) filter.status = status;
		if (paymentStatus) filter.paymentStatus = paymentStatus;
		if (cookId) filter.cookId = cookId;
		if (dateFrom || dateTo) filter.createdAt = {};
		if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
		if (dateTo) filter.createdAt.$lte = new Date(dateTo);

		// Fetch orders with populated references
		const orders = await Order.find(filter)
			.sort({ createdAt: -1 })
			.populate("userId", "fullName email phone profileImage")
			.populate("cookId", "fullName email phone profileImage")
			.populate("mealItems.mealId", "name description price images category");

		// Map to return clean response
		const data = orders.map((order) => ({
			orderId: order._id,
			status: order.status,
			paymentStatus: order.paymentStatus,
			totalAmount: order.totalAmount,
			serviceFee: order.serviceFee,
			deliveryFee: order.deliveryFee,
			tax: order.tax,
			discount: order.discount,
			note: order.note,
			deliveryType: order.deliveryType,
			deliveryAddress: order.deliveryAddress,
			mealItems: order.mealItems.map((item) => ({
				name: item.mealId.name,
				description: item.mealId.description,
				category: item.mealId.category,
				images: item.mealId.images,
				quantity: item.quantity,
				price: item.price,
			})),
			user: order.userId,
			cook: order.cookId,
			createdAt: order.createdAt,
			updatedAt: order.updatedAt,
			refundReference: order.refundReference,
			friendPaymentCode: order.friendPaymentCode,
		}));

		res.status(200).json({ orders: data });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const getSnapshot = async (req, res) => {
	try {
		const { date, zone } = req.query;

		// Use today by default
		const targetDate = date ? new Date(date) : new Date();
		const start = new Date(targetDate);
		start.setHours(0, 0, 0, 0);
		const end = new Date(targetDate);
		end.setHours(23, 59, 59, 999);

		const yesterdayStart = new Date(start);
		yesterdayStart.setDate(start.getDate() - 1);
		const yesterdayEnd = new Date(end);
		yesterdayEnd.setDate(end.getDate() - 1);

		// Orders today and yesterday
		const orderFilterToday = { createdAt: { $gte: start, $lte: end } };
		const orderFilterYesterday = {
			createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
		};
		if (zone) {
			orderFilterToday["deliveryAddress.city"] = zone;
			orderFilterYesterday["deliveryAddress.city"] = zone;
		}

		const ordersToday = await Order.find(orderFilterToday);
		const ordersYesterday = await Order.find(orderFilterYesterday);

		// Complaints (assuming negative reviews or cancelled orders)
		const complaintsToday = ordersToday.filter(
			(o) => o.status === "cancelled" || o.paymentStatus === "refunded",
		).length;
		const complaintsYesterday = ordersYesterday.filter(
			(o) => o.status === "cancelled" || o.paymentStatus === "refunded",
		).length;

		// Repeat customers
		const repeatCustomerIdsToday = [
			...new Set(
				ordersToday.filter((o) => o.userId).map((o) => o.userId.toString()),
			),
		];
		const repeatCustomerIdsYesterday = [
			...new Set(
				ordersYesterday.filter((o) => o.userId).map((o) => o.userId.toString()),
			),
		];

		const repeatPercentage =
			repeatCustomerIdsYesterday.length === 0
				? 0
				: (repeatCustomerIdsToday.length / repeatCustomerIdsYesterday.length) *
					100;

		// Average rating (from reviews)

		const avgRatingTodayAgg = await Review.aggregate([
			{
				$match: {
					createdAt: { $gte: start, $lte: end },
					targetType: "cook",
				},
			},
			{
				$group: {
					_id: null,
					avgRating: { $avg: "$rating" },
				},
			},
		]);
		const avgRatingYesterdayAgg = await Review.aggregate([
			{
				$match: {
					createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
					targetType: "cook",
				},
			},
			{
				$group: {
					_id: null,
					avgRating: { $avg: "$rating" },
				},
			},
		]);

		const avgRatingToday = avgRatingTodayAgg[0]?.avgRating || 0;
		const avgRatingYesterday = avgRatingYesterdayAgg[0]?.avgRating || 0;

		// At risk orders: orders pending > 2 hours or late
		const now = new Date();
		const atRiskOrders = ordersToday.filter(
			(o) =>
				(o.status === "pending" || o.status === "cooking") &&
				now - o.createdAt > 2 * 60 * 60 * 1000,
		);

		// Live orders
		const liveOrders = ordersToday
			.filter((o) => ["cooking", "ready"].includes(o.status))
			.map((o) => ({
				orderId: o._id,
				status: o.status,
				user: o.userId,
				cook: o.cookId,
				deliveryType: o.deliveryType,
				note: o.note,
			}));

		// Alerts
		const alerts = ordersToday
			.filter(
				(o) =>
					o.status === "cancelled" ||
					o.paymentStatus === "refunded" ||
					(o.status === "pending" && now - o.createdAt > 2 * 60 * 60 * 1000),
			)
			.map((o) => ({
				orderId: o._id,
				status: o.status,
				type:
					o.status === "cancelled"
						? "cook_cancellation"
						: o.paymentStatus === "refunded"
							? "payment_failure"
							: "late_order",
			}));

		// Zone activity: number of orders per city
		const zoneActivities = {};
		ordersToday.forEach((o) => {
			const cityName = o.deliveryAddress?.city || "Unknown";
			zoneActivities[cityName] = (zoneActivities[cityName] || 0) + 1;
		});

		// Cooks online / availability
		const cooksOnline = await CookProfile.find({ isAvailable: true });
		const totalCooks = await CookProfile.countDocuments();

		const availabilityPercentage =
			totalCooks === 0 ? 0 : (cooksOnline.length / totalCooks) * 100;

		// Orders per hour (basic)
		const ordersPerHour = {};
		ordersToday.forEach((o) => {
			const hour = o.createdAt.getHours();
			ordersPerHour[hour] = (ordersPerHour[hour] || 0) + 1;
		});

		res.status(200).json({
			avgRatingToday,
			avgRatingYesterday,
			complaintsToday,
			complaintsYesterday,
			repeatCustomerPercentage: repeatPercentage.toFixed(2),
			atRiskOrders: atRiskOrders.length,
			liveOrders,
			alerts,
			zoneActivities,
			totalActiveZones: Object.keys(zoneActivities).length,
			ordersPerHour,
			cooksOnline: cooksOnline.length,
			totalCooks,
			availabilityPercentage: availabilityPercentage.toFixed(2),
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// GET /api/admin/search?q=...
export const globalSearch = async (req, res) => {
	try {
		const { q } = req.query;

		if (!q || q.trim() === "") {
			return res.status(400).json({ message: "Search query is required" });
		}

		const searchRegex = new RegExp(q, "i");

		// Check if query is ObjectId (for direct lookup)
		const isObjectId = mongoose.Types.ObjectId.isValid(q);

		// ================= USERS =================
		const users = await User.find({
			$or: [
				{ fullName: searchRegex },
				{ email: searchRegex },
				{ phone: searchRegex },
			],
		})
			.limit(10)
			.select("fullName email phone");

		// ================= COOKS =================
		const cooks = await CookProfile.find({
			$or: [{ cookName: searchRegex }, { phone: searchRegex }],
		})
			.populate("userId", "fullName email phone")
			.limit(10);

		// ================= ORDERS =================
		const orderQuery = [];

		if (isObjectId) {
			orderQuery.push({ _id: q });
		}

		orderQuery.push(
			{ reference: searchRegex },
			{ paymentReference: searchRegex },
		);

		const orders = await Order.find({
			$or: orderQuery,
		})
			.populate("userId", "fullName email")
			.populate("cookId", "cookName")
			.limit(10);

		// ================= FORMAT RESPONSE =================
		const formattedUsers = users.map((u) => ({
			type: "user",
			id: u._id,
			name: u.fullName,
			email: u.email,
			phone: u.phone,
		}));

		const formattedCooks = cooks.map((c) => ({
			type: "cook",
			id: c._id,
			name: c.cookName || c.userId?.fullName,
			email: c.userId?.email,
			phone: c.phone || c.userId?.phone,
			isAvailable: c.isAvailable,
			rating: c.rating,
		}));

		const formattedOrders = orders.map((o) => ({
			type: "order",
			id: o._id,
			reference: o.reference,
			amount: o.totalAmount,
			paymentStatus: o.paymentStatus,
			user: o.userId?.fullName,
			cook: o.cookId?.cookName,
			createdAt: o.createdAt,
		}));

		res.status(200).json({
			users: formattedUsers,
			cooks: formattedCooks,
			orders: formattedOrders,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Search failed", error: error.message });
	}
};

export const getAllNotifications = async (req, res) => {
	try {
		const page = parseInt(req.query.page) || 1;
		const limit = parseInt(req.query.limit) || 50;
		const skip = (page - 1) * limit;

		const { unreadOnly } = req.query;

		// ===============================
		// BUILD FILTER
		// ===============================
		let filter = { userId: null }; // system/admin notifications

		if (unreadOnly === "true") {
			filter.isRead = false;
		}

		// ===============================
		// FETCH DATA
		// ===============================
		const notifications = await Notification.find(filter)
			.sort({ createdAt: -1 })
			.skip(skip)
			.limit(limit)
			.populate("userId", "fullName email role")
			.populate("targetId")
			.lean();

		const totalCount = await Notification.countDocuments(filter);

		return res.json({
			page,
			limit,
			totalCount,
			unreadCount: await Notification.countDocuments({
				...filter,
				isRead: false,
			}),
			notifications,
		});
	} catch (error) {
		console.error("Error fetching notifications:", error);
		return res.status(500).json({
			message: "Failed to fetch notifications",
			error: error.message,
		});
	}
};

export const markNotificationAsRead = async (req, res) => {
	try {
		const { id } = req.params;

		const notification = await Notification.findByIdAndUpdate(
			id,
			{
				isRead: true,
				readAt: new Date(),
			},
			{ new: true },
		);

		if (!notification) {
			return res.status(404).json({
				error: "Notification not found",
			});
		}

		return res.json({
			success: true,
			data: notification,
		});
	} catch (error) {
		console.error("Mark read error:", error);
		return res.status(500).json({
			error: error.message,
		});
	}
};

export const markAllNotificationsAsRead = async (req, res) => {
	try {
		const result = await Notification.updateMany(
			{
				userId: null,
				isRead: false,
			},
			{
				$set: {
					isRead: true,
					readAt: new Date(),
				},
			},
		);

		return res.json({
			success: true,
			modifiedCount: result.modifiedCount,
		});
	} catch (error) {
		console.error("Mark all read error:", error);
		return res.status(500).json({
			error: error.message,
		});
	}
};

// ---------------- Admin Profile ----------------
export const getAdminProfile = async (req, res) => {
	try {
		const admin = await User.findById(req.user.id);
		res.json(admin);
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

export const updateAdminProfile = async (req, res) => {
	try {
		const { fullName, phone } = req.body;
		const admin = await User.findById(req.user.id);
		if (!admin) return res.status(404).json({ message: "Admin not found" });

		if (fullName) admin.fullName = fullName;
		if (phone) admin.phone = phone;

		await admin.save();
		res.json({ message: "Profile updated successfully", admin });
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

export const updateAdminPassword = async (req, res) => {
	try {
		const { oldPassword, newPassword, confirmPassword } = req.body;
		if (!oldPassword || !newPassword || !confirmPassword)
			return res
				.status(400)
				.json({ message: "All password fields are required" });
		if (newPassword !== confirmPassword)
			return res
				.status(400)
				.json({ message: "New password and confirm do not match" });

		const admin = await User.findById(req.user.id).select("+password");
		const isMatch = await bcrypt.compare(oldPassword, admin.password);
		if (!isMatch)
			return res.status(400).json({ message: "Old password is incorrect" });

		admin.password = await bcrypt.hash(newPassword, 10);
		await admin.save();

		// Revoke sessions after password change
		await Session.deleteMany({ userId: admin._id });

		res.json({ message: "Password updated and sessions revoked" });
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

// ---------------- Team Management ----------------
export const addTeamMember = async (req, res) => {
	const resend = getResendInstance();
	try {
		const { fullName, email, phone, role } = req.body;
		if (!fullName || !email || !phone || !role)
			return res.status(400).json({ message: "All fields are required" });

		const existingUser = await User.findOne({ email });
		if (existingUser)
			return res.status(400).json({ message: "Email already exists" });

		const plainPassword = nanoid(10);
		const hashedPassword = await bcrypt.hash(plainPassword, 10);

		const user = await User.create({
			fullName,
			email,
			phone,
			role,
			password: hashedPassword,
			isCook: false,
		});

		// Send password via email
		const subject = "Your Admin Account Has Been Created";
		const message = `
			<p>Hello ${fullName},</p>
			<p>Your account has been created.</p>
			<p>Email: ${email}</p>
			<p>Password: <strong>${plainPassword}</strong></p>
			<p>Role: ${role}</p>
		`;

		await resend.emails.send({
			from: process.env.EMAIL_FROM,
			to: email,
			subject,
			html: message,
		});

		res.status(201).json({ message: "Team member added", user });
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

export const getTeamMembers = async (req, res) => {
	try {
		const team = await User.find({
			role: {
				$in: [
					"admin",
					"operations agent",
					"operations manager",
					"customer service",
				],
			},
		});
		res.json(team);
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

// ---------------- Active Sessions ----------------
export const getActiveSessions = async (req, res) => {
	try {
		const sessions = await Session.find({ userId: req.user.id });
		res.json(sessions);
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

export const revokeSession = async (req, res) => {
	try {
		const { sessionId } = req.params;
		await Session.findByIdAndDelete(sessionId);
		res.json({ message: "Session revoked" });
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

// ---------------- Service Zones ----------------
export const addOrUpdateZone = async (req, res) => {
	try {
		const { name, coverageAreas, activateImmediately = false } = req.body;
		if (!name || !coverageAreas || !coverageAreas.length)
			return res
				.status(400)
				.json({ message: "Zone name and coverage areas required" });

		let zone = await Zone.findOne({ name });
		if (zone) {
			zone.coverageAreas = coverageAreas;
			zone.isActive = activateImmediately;
			await zone.save();
		} else {
			zone = await Zone.create({
				name,
				coverageAreas,
				isActive: activateImmediately,
			});
		}

		res.json({ message: "Zone added/updated", zone });
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};

export const getZones = async (req, res) => {
	try {
		const zones = await Zone.find();
		res.json(zones);
	} catch (err) {
		res.status(500).json({ message: err.message });
	}
};
