import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendPushToUser } from "../services/pushService.js";
import { createAdminNotification } from "../utils/adminNotification.js";
import { getResendInstance } from "../utils/emailService.js";

// GET customers with filters and stats
export const getCustomers = async (req, res) => {
	try {
		const { status, city, dateFrom, dateTo, sortBy } = req.query;

		const filter = {};

		// Filter by status (active/suspended)
		if (status) {
			if (status === "active") {
				filter.status = "active";
				filter.isSuspended = false;
			} else if (status === "suspended") {
				filter.status = "suspended";
				filter.isSuspended = true;
			}
		}

		if (city) filter["location.address"] = { $regex: city, $options: "i" };

		if (dateFrom || dateTo) filter.createdAt = {};
		if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
		if (dateTo)
			filter.createdAt.$lte = new Date(
				new Date(dateTo).setHours(23, 59, 59, 999),
			);

		let query = User.find(filter);

		// Sorting
		if (sortBy === "newest") query = query.sort({ createdAt: -1 });
		if (sortBy === "oldest") query = query.sort({ createdAt: 1 });
		if (sortBy === "mostOrders") {
			const usersWithOrders = await Order.aggregate([
				{ $group: { _id: "$userId", orderCount: { $sum: 1 } } },
				{ $sort: { orderCount: -1 } },
			]);
			const ids = usersWithOrders.map((u) => u._id);
			query = User.find({ _id: { $in: ids } });
		}

		const users = await query;

		// Map with extra stats
		const data = await Promise.all(
			users.map(async (user) => {
				const orders = await Order.find({ userId: user._id });
				const lastOrder =
					orders.sort((a, b) => b.createdAt - a.createdAt)[0] || null;

				return {
					_id: user._id,
					fullName: user.fullName,
					email: user.email,
					phone: user.phone,
					status: user.status || "active",
					isSuspended: user.isSuspended || false, // ✅ Add this field
					suspensionReason: user.suspensionReason || null, // Optional
					suspensionNote: user.suspensionNote || null, // Optional
					city: user.location?.address || "",
					joinedAt: user.createdAt,
					lastActive: lastOrder ? lastOrder.updatedAt : null,
					ordersCount: orders.length,
					notes: Array.isArray(user.notes)
						? user.notes.map((n) => ({
								note: n.note,
								createdAt: n.createdAt,
							}))
						: [],
				};
			}),
		);

		// Stats
		const now = new Date();
		const today = new Date(now.setHours(0, 0, 0, 0));
		const last7Days = new Date();
		last7Days.setDate(now.getDate() - 7);
		const last30Days = new Date();
		last30Days.setDate(now.getDate() - 30);

		const stats = {
			totalCustomers: await User.countDocuments(),
			activeCustomers: await User.countDocuments({
				status: "active",
				isSuspended: false,
			}),
			suspendedCustomers: await User.countDocuments({
				status: "suspended",
				isSuspended: true,
			}),
			newToday: await User.countDocuments({ createdAt: { $gte: today } }),
			joinedLast7Days: await User.countDocuments({
				createdAt: { $gte: last7Days },
			}),
			joinedLast30Days: await User.countDocuments({
				createdAt: { $gte: last30Days },
			}),
			noPurchases: await User.countDocuments({
				_id: { $nin: await Order.distinct("userId") },
			}),
		};

		res.status(200).json({ stats, customers: data });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// GET single customer by ID
export const getCustomerById = async (req, res) => {
	try {
		const { userId } = req.params;

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		// Fetch user's orders
		const orders = await Order.find({ userId: user._id });

		const lastOrder =
			orders.sort((a, b) => b.createdAt - a.createdAt)[0] || null;

		// Optional: wallet transactions (if you want history)
		const transactions = await WalletTransaction.find({
			userId: user._id,
		}).sort({ createdAt: -1 });

		const customer = {
			_id: user._id,
			fullName: user.fullName,
			email: user.email,
			phone: user.phone,
			status: user.status || "active",
			isSuspended: user.isSuspended || false, // ✅ Add this field
			suspensionReason: user.suspensionReason || null, // Optional
			suspensionNote: user.suspensionNote || null, // Optional
			suspendedAt: user.suspendedAt || null, // Optional
			city: user.location?.address || "",
			joinedAt: user.createdAt,
			lastActive: lastOrder ? lastOrder.updatedAt : null,
			ordersCount: orders.length,
			walletBalance: user.walletBalance || 0,
			notes: user.notes || [],
			orders, // include if needed (can remove if too heavy)
			transactions, // include if needed
		};

		res.status(200).json({ customer });
	} catch (error) {
		console.error(error);
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// Add note to customer
export const addCustomerNote = async (req, res) => {
	try {
		const { userId } = req.params;
		const { note } = req.body;

		if (!note) {
			return res.status(400).json({ message: "Note is required" });
		}

		const user = await User.findByIdAndUpdate(
			userId,
			{
				$push: {
					notes: {
						note,
						createdAt: new Date(),
					},
				},
			},
			{ new: true },
		);

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		return res.status(200).json({
			message: "Note added",
			notes: user.notes,
		});
	} catch (error) {
		return res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// Message customer using Resend
export const messageCustomer = async (req, res) => {
	try {
		const { userId } = req.params;
		const { subject, message } = req.body;

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		const resend = getResendInstance();
		await resend.emails.send({
			from: process.env.EMAIL_FROM,
			to: user.email,
			subject,
			html: `<p>${message}</p>`,
		});

		res.status(200).json({ message: "Email sent successfully" });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// Credit customer wallet
export const creditCustomerWallet = async (req, res) => {
	try {
		const { userId } = req.params;
		const { amount, reason, note } = req.body;

		// Validate input
		if (!amount || amount <= 0) {
			return res.status(400).json({ message: "Invalid amount" });
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		// Update wallet
		user.walletBalance = (user.walletBalance || 0) + amount;
		await user.save();

		// Create transaction record
		await WalletTransaction.create({
			userId: user._id,
			type: "credit",
			amount,
			reason,
			note,
			reference: new mongoose.Types.ObjectId(),
		});

		// Send push notification (with error handling)
		let pushResult = { success: false, message: "Push not attempted" };

		try {
			console.log(`📱 Attempting to send push to user: ${userId}`);
			console.log(`User has pushTokens: ${user.pushTokens ? "Yes" : "No"}`);
			console.log(`Token count: ${user.pushTokens?.length || 0}`);

			pushResult = await sendPushToUser(
				userId,
				"Wallet Credited",
				`Your wallet has been credited with ${amount} NGN. Reason: ${reason}`,
				{ amount, reason, type: "wallet_credit" },
			);

			console.log("Push result:", pushResult);
		} catch (pushError) {
			console.error("❌ Push notification failed:", pushError.message);
			// Don't throw - just log the error
			pushResult = { success: false, error: pushError.message };
		}

		// Send response
		res.status(200).json({
			message: "Wallet credited",
			balance: user.walletBalance,
			pushNotificationSent: pushResult.success,
			pushDetails: pushResult,
		});

		// Create admin notification (don't await - fire and forget)
		createAdminNotification({
			title: "Wallet Credited",
			body: `The customer "${user.fullName}" has been credited with ${amount}`,
			type: "customer",
			data: { userId: req.user._id, amount, reason },
		}).catch((err) => console.error("Admin notification failed:", err));
	} catch (error) {
		console.error("Credit wallet error:", error);
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// Suspend / Reactivate customer
export const toggleCustomerStatus = async (req, res) => {
	try {
		const { userId } = req.params;
		const { action, note, notifyUser = true } = req.body;

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		// Prevent suspending admin accounts
		if (user.role === "admin" && action === "suspend") {
			return res.status(403).json({ message: "Cannot suspend admin accounts" });
		}

		if (action === "suspend") {
			user.status = "suspended";
			user.isSuspended = true;

			user.notes.push({
				note: `Account suspended by ${req.user.fullName || req.user.email}${note ? `: ${note}` : ""}`,
				createdAt: new Date(),
			});

			// If the user is also a cook, update their cook profile
			if (user.isCook) {
				await CookProfile.findOneAndUpdate(
					{ userId: user._id },
					{
						isSuspended: true,
						isAvailable: false,
						suspensionNote: note || null,
						suspendedAt: new Date(),
						suspendedBy: req.user.id,
					},
				);
			}
		} else if (action === "activate") {
			user.status = "active";
			user.isSuspended = false;

			user.notes.push({
				note: `Account reactivated by ${req.user.fullName || req.user.email}`,
				createdAt: new Date(),
			});

			// If the user is also a cook, update their cook profile
			if (user.isCook) {
				await CookProfile.findOneAndUpdate(
					{ userId: user._id },
					{
						isSuspended: false,
						isAvailable: true,
						suspensionNote: null,
						reactivatedAt: new Date(),
						reactivatedBy: req.user.id,
					},
				);
			}
		} else {
			return res
				.status(400)
				.json({ message: "Invalid action. Use 'suspend' or 'activate'" });
		}

		await user.save();

		// Send notifications
		if (notifyUser) {
			const title =
				action === "suspend" ? "Account Suspended" : "Account Reactivated";
			const body =
				action === "suspend"
					? `Your account has been suspended.${note ? ` Reason: ${note}` : " Please contact support."}`
					: "Your account has been reactivated. You can now access all features again.";

			try {
				await sendPushToUser(userId, title, body, { action });
			} catch (pushError) {
				console.error("Push notification error:", pushError.message);
			}
		}

		// Return response with isSuspended
		res.status(200).json({
			success: true,
			message: `User ${action === "suspend" ? "suspended" : "activated"} successfully`,
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				role: user.role,
				isCook: user.isCook,
				status: user.status,
				isSuspended: user.isSuspended, // ✅ Returns true/false
				suspensionNote: action === "suspend" ? note : null,
			},
		});
	} catch (error) {
		console.error("Error in toggleCustomerStatus:", error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};
