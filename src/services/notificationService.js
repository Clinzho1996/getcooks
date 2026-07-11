// backend/services/notificationService.js
import Notification from "../models/Notification.js";

export const sendNotification = async (
	userId,
	title,
	body,
	type = "system",
	data = {},
) => {
	try {
		const notification = await Notification.create({
			userId,
			title,
			body,
			type,
			data,
			created_at: new Date(),
		});

		console.log(`✅ In-app notification created for user ${userId}: ${title}`);
		return notification;
	} catch (error) {
		console.error("❌ Error creating in-app notification:", error.message);
		throw error;
	}
};
