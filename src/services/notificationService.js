// backend/services/notificationService.js
import Notification from "../models/Notification.js";

// Valid notification types based on your schema
const VALID_TYPES = [
	"system",
	"transaction",
	"general",
	"promotional",
	"customer",
	"cook",
	"order",
	"user",
	"payment",
	"review",
	"withdrawal",
	"order_confirmed",
	"order_paid",
	"order_cancelled",
	"cook_suspension",
];

export const sendNotification = async (
	userId,
	title,
	body,
	type = "general",
	data = {},
) => {
	try {
		// ✅ Validate that the type is allowed
		let validType = type;
		if (!VALID_TYPES.includes(type)) {
			console.warn(
				`⚠️ Notification type "${type}" is not in the allowed list. Using "general" instead.`,
			);
			validType = "general";
		}

		// ✅ Don't include created_at - timestamps handles it automatically
		const notification = await Notification.create({
			userId: userId || null,
			title,
			body,
			type: validType,
			data: data || {},
		});

		console.log(`✅ In-app notification created for user ${userId}: ${title}`);
		return notification;
	} catch (error) {
		console.error("❌ Error creating in-app notification:", error.message);
		console.error("❌ Error details:", error.errors);
		throw error;
	}
};

// ✅ Add a function to send admin notification
export const sendAdminNotification = async (
	title,
	body,
	type = "general",
	data = {},
) => {
	try {
		let validType = type;
		if (!VALID_TYPES.includes(type)) {
			validType = "general";
		}

		const notification = await Notification.create({
			userId: null, // Admin notification, no specific user
			title,
			body,
			type: validType,
			data: data || {},
		});

		console.log(`✅ Admin notification created: ${title}`);
		return notification;
	} catch (error) {
		console.error("❌ Error creating admin notification:", error.message);
		throw error;
	}
};
