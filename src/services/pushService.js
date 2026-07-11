// backend/services/pushService.js
import admin from "../config/firebase.js";
import User from "../models/User.js";

// Send push notification to a specific user
// backend/services/pushService.js - Updated version
export const sendPushToUser = async (userId, title, body, data = {}) => {
	try {
		const user = await User.findById(userId).select(
			"pushTokens email fullName",
		);

		if (!user) {
			return { success: false, message: "User not found" };
		}

		if (!user.pushTokens || user.pushTokens.length === 0) {
			return { success: false, message: "No device tokens" };
		}

		// Extract valid token strings
		const tokens = user.pushTokens.map((t) => t.token).filter(Boolean);

		if (tokens.length === 0) {
			return { success: false, message: "No valid tokens" };
		}

		const message = {
			notification: {
				title,
				body,
			},
			data: {
				...Object.fromEntries(
					Object.entries(data).map(([k, v]) => [k, String(v)]),
				),
				userId: user._id.toString(),
				timestamp: new Date().toISOString(),
			},
			tokens,
		};

		const response = await admin.messaging().sendEachForMulticast(message);

		const errors = [];
		const invalidTokens = [];

		response.responses.forEach((res, index) => {
			if (!res.success) {
				const errorMsg = res.error?.message || "Unknown error";
				const errorCode = res.error?.code || "unknown";

				console.log(`❌ Token failed: ${errorCode} - ${errorMsg}`);

				errors.push({
					token: tokens[index],
					error: errorMsg,
					code: errorCode,
				});

				// ✅ Check for invalid token conditions (more comprehensive)
				const isInvalidToken =
					errorMsg.includes("NotRegistered") ||
					errorMsg.includes("registration-token-not-registered") ||
					errorMsg.includes("invalid-registration-token") ||
					errorCode === "messaging/registration-token-not-registered" ||
					errorCode === "messaging/invalid-registration-token";

				if (isInvalidToken) {
					console.log(
						`🗑 Marking token as invalid: ${tokens[index].substring(0, 50)}...`,
					);
					invalidTokens.push(tokens[index]);
				}
			}
		});

		// ✅ Remove all invalid tokens in one operation
		if (invalidTokens.length > 0) {
			console.log(
				`🗑 Removing ${invalidTokens.length} invalid tokens from database`,
			);

			await User.findByIdAndUpdate(user._id, {
				$pull: { pushTokens: { token: { $in: invalidTokens } } },
			});

			console.log(`✅ Removed ${invalidTokens.length} invalid tokens`);
		}

		return {
			success: response.successCount > 0,
			sent: response.successCount,
			failed: response.failureCount,
			errors: errors.length > 0 ? errors : undefined,
			invalidTokensRemoved: invalidTokens.length,
		};
	} catch (error) {
		console.error("❌ Error sending push notification:", error);
		return {
			success: false,
			error: error.message,
			code: error.code,
		};
	}
};

// Save push token for user (updated for pushTokens)
export const saveDeviceToken = async (
	userId,
	token,
	deviceType,
	deviceId = null,
) => {
	try {
		console.log(`💾 Saving push token for user: ${userId}`);

		const user = await User.findById(userId);

		if (!user) {
			throw new Error("User not found");
		}

		// Initialize pushTokens array if it doesn't exist
		if (!user.pushTokens) {
			user.pushTokens = [];
		}

		// Remove this token from any other user first (cleanup)
		await User.updateMany(
			{ "pushTokens.token": token },
			{ $pull: { pushTokens: { token: token } } },
		);

		// Check if token already exists for this user
		const existingToken = user.pushTokens.find((t) => t.token === token);

		if (existingToken) {
			existingToken.lastUsed = new Date();
			existingToken.platform = deviceType;
			if (deviceId) existingToken.deviceId = deviceId;
		} else {
			user.pushTokens.push({
				token,
				platform: deviceType,
				deviceId: deviceId,
				lastUsed: new Date(),
				createdAt: new Date(),
			});
		}

		await user.save();
		console.log(`✅ Push token saved for ${user.email}`);

		return user;
	} catch (error) {
		console.error("Error saving push token:", error);
		throw error;
	}
};

// Remove push token
export const removeDeviceToken = async (userId, token) => {
	try {
		const result = await User.findByIdAndUpdate(
			userId,
			{ $pull: { pushTokens: { token: token } } },
			{ new: true },
		);

		console.log(`✅ Push token removed for user ${userId}`);
		return result;
	} catch (error) {
		console.error("Error removing push token:", error);
		throw error;
	}
};

// Remove all push tokens for a user
export const removeAllDeviceTokens = async (userId) => {
	try {
		const result = await User.findByIdAndUpdate(
			userId,
			{ $set: { pushTokens: [] } },
			{ new: true },
		);

		console.log(`✅ All push tokens removed for user ${userId}`);
		return result;
	} catch (error) {
		console.error("Error removing all push tokens:", error);
		throw error;
	}
};

export const sendPush = async (tokens, { title, body, data = {} }) => {
	try {
		// Validate Firebase is initialized
		if (!admin || admin.apps.length === 0) {
			console.error("❌ Firebase not initialized");
			return { success: false, error: "Firebase not initialized" };
		}

		if (!tokens || tokens.length === 0) {
			console.log("⚠️ No tokens provided for push notification");
			return { successCount: 0, failureCount: 0 };
		}

		// Filter out invalid tokens (empty, too short, not containing :)
		const validTokens = tokens.filter(
			(token) =>
				token &&
				typeof token === "string" &&
				token.length > 20 &&
				token.includes(":"),
		);

		if (validTokens.length === 0) {
			console.log("⚠️ No valid tokens after filtering");
			return { successCount: 0, failureCount: 0 };
		}

		console.log(`📤 Sending push to ${validTokens.length} devices`);
		console.log(`Title: ${title}`);

		const message = {
			tokens: validTokens,
			notification: {
				title: title || "New Notification",
				body: body || "",
			},
			data: Object.fromEntries(
				Object.entries(data || {}).map(([k, v]) => [k, String(v)]),
			),
		};

		const response = await admin.messaging().sendEachForMulticast(message);

		console.log(
			`✅ Push results: ${response.successCount} success, ${response.failureCount} failed`,
		);

		// Log specific failures for debugging
		if (response.failureCount > 0) {
			response.responses.forEach((resp, idx) => {
				if (!resp.success) {
					console.error(`❌ Failed token ${idx}: ${resp.error?.message}`);
				}
			});
		}

		return {
			success: true,
			successCount: response.successCount,
			failureCount: response.failureCount,
			responses: response.responses,
		};
	} catch (error) {
		console.error("❌ FCM Send Error:", error);
		console.error("Error details:", error.message);
		if (error.code) console.error("Error code:", error.code);

		return {
			success: false,
			error: error.message,
			code: error.code,
			successCount: 0,
			failureCount: tokens?.length || 0,
		};
	}
};
