// controllers/callController.js
import pkg from "agora-access-token";
const { RtcRole, RtcTokenBuilder } = pkg;

import Order from "../models/Order.js";

// Generate Agora token for a call between user and cook
// controllers/callController.js - Enhanced version
export const generateCallToken = async (req, res) => {
	try {
		const { orderId, role, isRejoining = false } = req.body;
		const requestingUserId = req.user._id;

		if (!orderId || !role) {
			return res.status(400).json({ message: "orderId and role are required" });
		}

		// Fetch order and populate user & cook
		const order = await Order.findById(orderId).populate("userId cookId");
		if (!order) return res.status(404).json({ message: "Order not found" });

		// Verify user role matches the order
		let isAuthorized = false;
		let otherPartyId = null;
		let otherPartyName = "";

		if (role === "user") {
			isAuthorized =
				order.userId._id.toString() === requestingUserId.toString();
			otherPartyId = order.cookId._id;
			otherPartyName = order.cookId.name || "Cook";
		} else if (role === "cook") {
			isAuthorized =
				order.cookId._id.toString() === requestingUserId.toString();
			otherPartyId = order.userId._id;
			otherPartyName = order.userId.name || "User";
		}

		if (!isAuthorized) {
			return res.status(403).json({ message: "Not authorized for this role" });
		}

		// Define a unique channel per order
		const channelName = `order_${order._id}`;

		// Generate numeric UID from user ID (consistent for rejoin)
		const uid = parseInt(requestingUserId.toString().slice(-8), 16);

		// For rejoining, use a shorter expiration? No, keep 1 hour
		const expirationTime = Math.floor(Date.now() / 1000) + 3600;
		const agoraRole = RtcRole.PUBLISHER;

		const token = RtcTokenBuilder.buildTokenWithUid(
			process.env.AGORA_APP_ID,
			process.env.AGORA_CERT,
			channelName,
			uid,
			agoraRole,
			expirationTime,
		);

		// Return comprehensive response for Flutter client
		res.json({
			success: true,
			token,
			channelName,
			uid,
			expiresAt: expirationTime,
			appId: process.env.AGORA_APP_ID,
			orderId: order._id,
			role,
			otherPartyId,
			otherPartyName,
			callTimeout: 30000,
		});
	} catch (error) {
		console.error("Error generating call token:", error.message);
		res.status(500).json({ message: "Failed to generate call token" });
	}
};

// controllers/callController.js - Add this new endpoint
export const updateCallStatus = async (req, res) => {
	try {
		const { orderId, status, duration, endedBy } = req.body;
		const userId = req.user._id;

		// You can create a CallLog model to track call history
		const callLog = {
			orderId,
			userId,
			status,
			duration,
			endedBy,
			timestamp: new Date(),
		};

		// Update order with call status (optional)
		await Order.findByIdAndUpdate(orderId, {
			$push: { callLogs: callLog },
			lastCallStatus: status,
		});

		res.json({ success: true, message: "Call status updated" });
	} catch (error) {
		console.error("Error updating call status:", error.message);
		res.status(500).json({ message: "Failed to update call status" });
	}
};
