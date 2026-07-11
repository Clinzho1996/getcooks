// backend/controllers/notificationController.js
import admin from "../config/firebase.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";
import { sendPush } from "../services/pushService.js";
import { getResendInstance } from "../utils/emailService.js";
// ===============================
// GET USER NOTIFICATIONS
// ===============================
export const getNotifications = async (req, res) => {
	try {
		const userId = req.user._id;
		const { page = 1, limit = 20, unread_only = false } = req.query;

		const query = { userId };
		if (unread_only === "true") {
			query.is_read = false;
		}

		const notifications = await Notification.find(query)
			.sort({ created_at: -1 })
			.skip((page - 1) * limit)
			.limit(parseInt(limit));

		const total = await Notification.countDocuments(query);
		const unreadCount = await Notification.countDocuments({
			userId,
			is_read: false,
		});

		res.status(200).json({
			success: true,
			data: notifications,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / limit),
			},
			unreadCount,
		});
	} catch (err) {
		console.error("Get notifications error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// MARK NOTIFICATION AS READ
// ===============================
export const markAsRead = async (req, res) => {
	try {
		const userId = req.user._id;
		const { id } = req.params;

		const notification = await Notification.findOneAndUpdate(
			{ _id: id, userId },
			{
				is_read: true,
				read_at: new Date(),
			},
			{ new: true },
		);

		if (!notification) {
			return res.status(404).json({ error: "Notification not found" });
		}

		res.status(200).json({
			success: true,
			data: notification,
		});
	} catch (err) {
		console.error("Mark as read error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// MARK ALL AS READ
// ===============================
export const markAllAsRead = async (req, res) => {
	try {
		const userId = req.user._id;

		await Notification.updateMany(
			{ userId, is_read: false },
			{
				is_read: true,
				read_at: new Date(),
			},
		);

		res.status(200).json({
			success: true,
			message: "All notifications marked as read",
		});
	} catch (err) {
		console.error("Mark all as read error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// DELETE NOTIFICATION
// ===============================
export const deleteNotification = async (req, res) => {
	try {
		const userId = req.user._id;
		const { id } = req.params;

		const notification = await Notification.findOneAndDelete({
			_id: id,
			userId,
		});

		if (!notification) {
			return res.status(404).json({ error: "Notification not found" });
		}

		res.status(200).json({
			success: true,
			message: "Notification deleted",
		});
	} catch (err) {
		console.error("Delete notification error:", err);
		res.status(500).json({ error: err.message });
	}
};

// backend/controllers/notificationController.js
// ===============================
// REGISTER PUSH TOKEN
// ===============================
export const registerPushToken = async (req, res) => {
	try {
		const userId = req.user._id;
		const { token, platform, deviceId } = req.body;

		console.log("📱 Registering push token:", {
			token,
			platform,
			deviceId,
		});

		if (!token || !platform) {
			return res.status(400).json({
				error: "Token and platform are required",
			});
		}

		// ===============================
		// BASIC TOKEN VALIDATION
		// ===============================
		if (!token.includes(":") || token.length < 30) {
			return res.status(400).json({
				error: "Invalid FCM token format",
			});
		}

		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({
				error: "User not found",
			});
		}

		// ===============================
		// DEVICE ID NORMALIZATION
		// ===============================
		let deviceIdString = null;

		if (deviceId) {
			deviceIdString =
				typeof deviceId === "object"
					? deviceId.data || deviceId.token || JSON.stringify(deviceId)
					: String(deviceId);
		}

		// ===============================
		// INIT ARRAY
		// ===============================
		if (!user.pushTokens) {
			user.pushTokens = [];
		}

		// ===============================
		// REMOVE INVALID STRUCTURES
		// ===============================
		user.pushTokens = user.pushTokens.filter(
			(t) => t?.token && typeof t.token === "string",
		);

		// ===============================
		// UPSERT TOKEN
		// ===============================
		const existingIndex = user.pushTokens.findIndex((t) => t.token === token);

		if (existingIndex !== -1) {
			user.pushTokens[existingIndex].lastUsed = new Date();
			user.pushTokens[existingIndex].platform = platform;

			if (deviceIdString) {
				user.pushTokens[existingIndex].deviceId = deviceIdString;
			}
		} else {
			user.pushTokens.push({
				token,
				platform,
				deviceId: deviceIdString,
				createdAt: new Date(),
				lastUsed: new Date(),
			});
		}

		await user.save();

		console.log("✅ Token saved successfully");

		res.status(200).json({
			success: true,
			message: "Push token registered successfully",
		});
	} catch (err) {
		console.error("❌ Register push token error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// UNREGISTER PUSH TOKEN
// ===============================
export const unregisterPushToken = async (req, res) => {
	try {
		const userId = req.user._id;
		const { token } = req.body;

		if (!token) {
			return res.status(400).json({ error: "Token is required" });
		}

		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		if (!user.pushTokens) {
			user.pushTokens = [];
		}

		// Remove the token
		user.pushTokens = user.pushTokens.filter((t) => t.token !== token);

		await user.save();

		res.status(200).json({
			success: true,
			message: "Push token unregistered",
		});
	} catch (err) {
		console.error("Unregister push token error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// UPDATE NOTIFICATION SETTINGS
// ===============================
export const updateNotificationSettings = async (req, res) => {
	try {
		const userId = req.user._id;
		const settings = req.body;

		const user = await User.findByIdAndUpdate(
			userId,
			{ notificationSettings: settings },
			{ new: true },
		).select("notificationSettings");

		res.status(200).json({
			success: true,
			data: user.notificationSettings,
		});
	} catch (err) {
		console.error("Update notification settings error:", err);
		res.status(500).json({ error: err.message });
	}
};

// ===============================
// GET NOTIFICATION SETTINGS
// ===============================
export const getNotificationSettings = async (req, res) => {
	try {
		const userId = req.user._id;
		const user = await User.findById(userId).select("notificationSettings");

		res.status(200).json({
			success: true,
			data: user.notificationSettings,
		});
	} catch (err) {
		console.error("Get notification settings error:", err);
		res.status(500).json({ error: err.message });
	}
};

export const createNotification = async (req, res) => {
	const resend = getResendInstance();

	try {
		const {
			userId,
			title,
			body,
			type = "system",
			data = {},
			sendPush = true,
			sendEmail = false,
		} = req.body;

		// ===============================
		// VALIDATION
		// ===============================
		if (!userId || !title || !body) {
			return res.status(400).json({
				error: "Missing required fields",
			});
		}

		// ===============================
		// CREATE NOTIFICATION
		// ===============================
		const notification = await Notification.create({
			userId,
			title,
			body,
			type,
			data,
			created_at: new Date(),
		});

		// ===============================
		// FETCH USER
		// ===============================
		const user = await User.findById(userId);

		if (!user) {
			return res.status(404).json({
				error: "User not found",
			});
		}

		// ===============================
		// SEND PUSH (FCM)
		// ===============================
		if (sendPush && user.notificationSettings?.push_enabled !== false) {
			const validTokens = [];
			const invalidTokens = [];

			// Filter and validate tokens
			if (user.pushTokens && user.pushTokens.length > 0) {
				for (const pushToken of user.pushTokens) {
					if (
						pushToken.token &&
						typeof pushToken.token === "string" &&
						pushToken.token.length > 10
					) {
						// Basic validation - FCM tokens are usually long strings
						if (
							pushToken.token.startsWith("e") ||
							pushToken.token.includes(":")
						) {
							validTokens.push(pushToken.token);
						} else {
							invalidTokens.push(pushToken.token);
						}
					} else {
						if (pushToken.token) invalidTokens.push(pushToken.token);
					}
				}
			}

			console.log("📱 Valid tokens found:", validTokens.length);
			console.log("📱 Invalid tokens found:", invalidTokens.length);

			// Remove invalid tokens from database
			if (invalidTokens.length > 0) {
				await User.findByIdAndUpdate(user._id, {
					$pull: {
						pushTokens: { token: { $in: invalidTokens } },
					},
				});
				console.log(
					"🗑 Removed invalid tokens from database:",
					invalidTokens.length,
				);
			}

			// Send push notifications only if there are valid tokens
			if (validTokens.length > 0) {
				try {
					// Send in batches of 500 (FCM limit)
					const batchSize = 500;
					let successCount = 0;
					let failureCount = 0;

					for (let i = 0; i < validTokens.length; i += batchSize) {
						const batchTokens = validTokens.slice(i, i + batchSize);

						const response = await admin.messaging().sendEachForMulticast({
							tokens: batchTokens,
							notification: {
								title: title,
								body: body,
							},
							data: {
								notificationId: notification._id.toString(),
								type: type,
								...Object.fromEntries(
									Object.entries(data).map(([k, v]) => [k, String(v)]),
								),
							},
						});

						successCount += response.successCount;
						failureCount += response.failureCount;

						// Handle failed tokens in this batch
						const failedTokensInBatch = [];
						response.responses.forEach((resp, index) => {
							if (!resp.success) {
								const errorMsg = resp.error?.message;
								const failedToken = batchTokens[index];
								console.log(`❌ Token failed: ${failedToken} | ${errorMsg}`);

								// Mark as invalid for specific errors
								if (
									errorMsg?.includes("registration-token-not-registered") ||
									errorMsg?.includes("invalid-registration-token") ||
									errorMsg?.includes("not-registered")
								) {
									failedTokensInBatch.push(failedToken);
								}
							}
						});

						// Remove failed tokens from database
						if (failedTokensInBatch.length > 0) {
							await User.findByIdAndUpdate(user._id, {
								$pull: {
									pushTokens: { token: { $in: failedTokensInBatch } },
								},
							});
							console.log(
								"🗑 Removed invalid tokens from batch:",
								failedTokensInBatch.length,
							);
						}
					}

					console.log(
						`✅ Push sent: ${successCount} success, ${failureCount} failed`,
					);

					// Mark push status
					notification.is_push_sent = successCount > 0;
					await notification.save();
				} catch (err) {
					console.error("❌ Push send failed:", err.message);
					// Don't throw error, just log it
				}
			} else {
				console.log("⚠️ No valid push tokens available");
			}
		}

		// ===============================
		// SEND EMAIL
		// ===============================
		if (sendEmail && user.email) {
			try {
				await resend.emails.send({
					from: process.env.EMAIL_FROM,
					to: user.email,
					subject: title,
					html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #4CAF50;">${title}</h2>
              <p>${body}</p>
              ${
								data && Object.keys(data).length > 0
									? `
                <div style="background-color: #f4f4f4; padding: 10px; border-radius: 5px; margin-top: 10px;">
                  <p style="font-size: 12px; color: #666;">Additional information available in the app.</p>
                </div>
              `
									: ""
							}
              <hr style="margin: 20px 0;" />
              <p style="font-size: 12px; color: #777;">GetAMeal - Connecting food lovers with amazing home cooks</p>
            </div>
          `,
				});

				notification.is_email_sent = true;
				await notification.save();
				console.log(`✅ Email sent to ${user.email}`);
			} catch (err) {
				console.error("❌ Email send failed:", err.message);
			}
		}

		// ===============================
		// RESPONSE
		// ===============================
		return res.status(201).json({
			success: true,
			data: {
				id: notification._id,
				title: notification.title,
				body: notification.body,
				type: notification.type,
				is_read: notification.is_read,
				created_at: notification.created_at,
				push_sent: notification.is_push_sent,
				email_sent: notification.is_email_sent,
			},
		});
	} catch (err) {
		console.error("❌ Create notification error:", err);

		// Handle validation errors specifically
		if (err.name === "ValidationError") {
			return res.status(400).json({
				error: "Validation error",
				details: err.message,
			});
		}

		return res.status(500).json({
			error: err.message,
		});
	}
};

// backend/controllers/notificationController.js - Add this endpoint

// ===============================
// SEND PUSH TO ALL USERS (Admin)
// ===============================
// backend/controllers/notificationController.js
export const sendPushToAllUsers = async (req, res) => {
	const resend = getResendInstance();
	try {
		const { title, body, type, data } = req.body;

		if (!title || !body) {
			return res.status(400).json({
				success: false,
				error: "Title and body are required",
			});
		}

		// Use valid enum values from your model
		const validTypes = ["system", "transaction", "general"];
		const notificationType = validTypes.includes(type) ? type : "system";

		// Find all users (not just those with push tokens) - so everyone gets notification in app
		const users = await User.find({});

		console.log(`📢 Sending notification to ${users.length} users`);
		console.log(`Title: ${title}`);
		console.log(`Body: ${body}`);
		console.log(`Type: ${notificationType}`);

		let notificationsCreated = 0;
		let pushesSent = 0;

		for (const user of users) {
			try {
				// Create notification record in database for EVERY user
				await Notification.create({
					userId: user._id,
					title,
					body,
					type: notificationType,
					data: data || {},
					created_at: new Date(),
				});
				notificationsCreated++;

				// Send push notification ONLY to users with valid push tokens
				if (user.pushTokens && user.pushTokens.length > 0) {
					const tokens = user.pushTokens.map((t) => t.token);
					await sendPush(tokens, {
						title,
						body,
						data: {
							type: notificationType,
							...data,
						},
					});
					pushesSent++;
				}
			} catch (userError) {
				console.error(`Error for user ${user._id}:`, userError.message);
			}
		}

		res.status(200).json({
			success: true,
			message: `Sent to ${users.length} users`,
			notificationsCreated,
			pushesSent,
		});
	} catch (err) {
		console.error("Send push to all users error:", err);
		res.status(500).json({ error: err.message });
	}
};
// ===============================
// SEND BULK NOTIFICATION (Admin)
// ===============================
export const sendBulkNotification = async (req, res) => {
	const resend = getResendInstance();

	try {
		const {
			title,
			body,
			type = "system",
			target = "all",
			userIds = [],
			zones = [],
			data = {},
			pushOnly = false,
		} = req.body;

		// ===============================
		// VALIDATION
		// ===============================
		if (!title || !body) {
			return res.status(400).json({
				error: "Title and body are required",
			});
		}

		// ===============================
		// BUILD QUERY
		// ===============================
		let query = {};

		switch (target) {
			case "customers":
				query.role = "user";
				query.$or = [{ isCook: false }, { isCook: { $exists: false } }];
				break;

			case "cooks":
				query.isCook = true;
				break;

			case "admins":
				query.role = "admin";
				break;

			case "specific":
				if (!userIds.length) {
					return res.status(400).json({
						error: "userIds required for specific target",
					});
				}
				query._id = { $in: userIds };
				break;

			case "all":
			default:
				break;
		}

		// ===============================
		// ZONE FILTER
		// ===============================
		if (zones.length) {
			query["location.address"] = {
				$regex: zones.map((z) => z.trim()).join("|"),
				$options: "i",
			};
		}

		// ===============================
		// PUSH SETTINGS FILTER
		// ===============================
		if (pushOnly) {
			query["notificationSettings.push_enabled"] = true;
		}

		console.log("FINAL QUERY:", JSON.stringify(query, null, 2));

		// ===============================
		// FETCH USERS
		// ===============================
		const users = await User.find(query);

		if (!users.length) {
			return res.status(200).json({
				success: true,
				message: "No users found for this target",
				count: 0,
			});
		}

		// ===============================
		// SAVE NOTIFICATIONS
		// ===============================
		const notificationDocs = users.map((user) => ({
			userId: user._id,
			title,
			body,
			type,
			data,
		}));

		await Notification.insertMany(notificationDocs);

		// ===============================
		// PREPARE PUSH TOKENS
		// ===============================
		const pushTokens = users.flatMap(
			(user) => user.pushTokens?.map((t) => t.token) || [],
		);

		// ===============================
		// SEND PUSH (BATCHED)
		// ===============================
		const pushChunkSize = 100;

		for (let i = 0; i < pushTokens.length; i += pushChunkSize) {
			const chunk = pushTokens.slice(i, i + pushChunkSize);

			try {
				await sendPush(chunk, {
					title,
					body,
					data: { type, ...data },
				});
			} catch (err) {
				console.error("Push batch failed:", err.message);
			}
		}

		// ===============================
		// SEND EMAIL (ONLY IF NOT PUSH ONLY)
		// ===============================
		if (!pushOnly) {
			const emails = users.map((u) => u.email).filter(Boolean);

			const emailChunkSize = 50;

			for (let i = 0; i < emails.length; i += emailChunkSize) {
				const chunk = emails.slice(i, i + emailChunkSize);

				try {
					await resend.emails.send({
						from: process.env.EMAIL_FROM,
						to: chunk,
						subject: title,
						html: `
							<h2>${title}</h2>
							<p>${body}</p>
						`,
					});
				} catch (err) {
					console.error("Email batch failed:", err.message);
				}
			}
		}

		// ===============================
		// RESPONSE
		// ===============================
		return res.status(201).json({
			success: true,
			message: `Notification sent to ${users.length} users`,
			count: users.length,
			pushCount: pushTokens.length,
		});
	} catch (err) {
		console.error("Bulk notification error:", err);
		return res.status(500).json({
			error: err.message,
		});
	}
};

// Add to notificationController.js
export const testPushToToken = async (req, res) => {
	try {
		const { token, title, body } = req.body;

		if (!token) {
			return res.status(400).json({ error: "Token is required" });
		}

		console.log("📤 Testing push to token:", token.substring(0, 50) + "...");

		const message = {
			token: token,
			notification: {
				title: title || "Test Notification",
				body: body || "This is a test from your backend",
			},
			data: {
				test: "true",
				timestamp: Date.now().toString(),
			},
		};

		const response = await admin.messaging().send(message);

		console.log("✅ Push sent successfully:", response);

		res.json({
			success: true,
			message: "Push sent successfully",
			response: response,
		});
	} catch (error) {
		console.error("❌ Push failed:", error.code, error.message);

		res.status(500).json({
			success: false,
			error: error.message,
			code: error.code,
			suggestion:
				error.code === "messaging/registration-token-not-registered"
					? "Token is invalid - please regenerate on client"
					: "Check Firebase configuration",
		});
	}
};
