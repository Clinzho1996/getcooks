// utils/adminNotification.js

import Notification from "../models/Notification.js";

export const createAdminNotification = async ({
	title,
	body,
	type = "system",
	data = {},
}) => {
	try {
		await Notification.create({
			userId: null, // THIS is the key
			title,
			body,
			type,
			data,
			created_at: new Date(),
		});
	} catch (error) {
		console.error("Admin notification error:", error.message);
	}
};
