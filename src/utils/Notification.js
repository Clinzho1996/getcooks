export const emitOrderUpdate = (order) => {
	import("../server.js").then(({ io }) => {
		io.to(order.userId.toString()).emit("orderUpdate", order);
	});
};

export const sendNotification = async (userId, message) => {
	const token = "DEVICE_TOKEN_FROM_DB";
	await sendPushNotification(token, "Getameal Update", message);
};
