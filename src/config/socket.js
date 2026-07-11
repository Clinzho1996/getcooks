import { Server } from "socket.io";

let io;

export const initSocket = (server) => {
	io = new Server(server, {
		cors: { origin: "*" },
	});

	// Socket.io
	io.on("connection", (socket) => {
		console.log("New client connected:", socket.id);

		// Join rooms
		socket.on("join_user", (userId) => {
			socket.join(`user_${userId}`);
			console.log(`User ${userId} joined user_${userId}`);
		});

		socket.on("join_cook", (cookId) => {
			socket.join(`cook_${cookId}`);
			console.log(`Cook ${cookId} joined cook_${cookId}`);
		});

		socket.on("join_order", (orderId) => {
			socket.join(`order_${orderId}`);
			console.log(`Socket joined order_${orderId}`);
		});

		// ---- Call flow ----
		// User requests a call
		socket.on("request_call", ({ orderId, fromUserId, channelName, uid }) => {
			console.log(`Call requested by user ${fromUserId} for order ${orderId}`);
			io.to(`order_${orderId}`).emit("incoming_call", {
				orderId,
				fromUserId,
				channelName,
				uid,
			});
		});

		// Cook accepts the call
		socket.on("accept_call", ({ orderId, cookId, channelName, uid }) => {
			console.log(`Call accepted by cook ${cookId} for order ${orderId}`);
			io.to(`order_${orderId}`).emit("call_accepted", {
				orderId,
				cookId,
				channelName,
				uid,
			});
		});

		// Cook rejects the call
		socket.on("reject_call", ({ orderId, cookId }) => {
			console.log(`Call rejected by cook ${cookId} for order ${orderId}`);
			io.to(`order_${orderId}`).emit("call_rejected", { orderId, cookId });
		});

		// Optional: handle leaving a call
		socket.on("leave_call", ({ orderId, userId }) => {
			console.log(`User ${userId} left call for order ${orderId}`);
			io.to(`order_${orderId}`).emit("call_ended", { orderId, userId });
		});

		socket.on("disconnect", () => {
			console.log("Client disconnected:", socket.id);
		});
	});
};

export const getIO = () => io;
