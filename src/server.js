import dotenv from "dotenv";

dotenv.config(); // MUST be first line

import cors from "cors";
import express from "express";
import http from "http";
import morgan from "morgan";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import bankRoutes from "./routes/bankRoutes.js";
import cartRoutes from "./routes/cartRoutes.js";
import cookRoutes from "./routes/cookRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import foodCategoryRoutes from "./routes/foodCategoryRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import mealRoutes from "./routes/mealRoutes.js";
import notificationRoutes from "./routes/notification.js";
import orderRoutes from "./routes/orderRoutes.js";
import payoutRoutes from "./routes/payoutRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import webhookRoutes from "./routes/webhooks.js";

connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/user", userRoutes);
app.use("/api/cook", cookRoutes);
app.use("/api/category", foodCategoryRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/banks", bankRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/payouts", payoutRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/customer", customerRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);

// Socket.io
// Update your socket.io configuration
io.on("connection", (socket) => {
	// Store user info
	socket.on("user-online", (userId) => {
		socket.userId = userId;
		socket.join(`user_${userId}`);
	});

	// Join order room for call signaling
	socket.on("join-order-room", ({ orderId, userId }) => {
		socket.join(`order_${orderId}`);
		socket.to(`order_${orderId}`).emit("user-joined-call-room", { userId });
	});

	// ✅ FIXED: Call signaling with orderId
	socket.on(
		"call-user",
		({ offer, to, from, fromName, channelName, orderId }) => {
			// Forward call to the recipient with orderId
			io.to(`user_${to}`).emit("incoming-call", {
				offer,
				from,
				fromName,
				channelName,
				orderId, // ✅ Now included
				timestamp: Date.now(),
			});
		},
	);

	// Answer call
	socket.on("answer-call", ({ answer, to, from, orderId }) => {
		io.to(`user_${to}`).emit("call-answered", {
			answer,
			from,
			orderId,
		});
	});

	// ICE candidate exchange
	socket.on("ice-candidate", ({ candidate, to, from, orderId }) => {
		io.to(`user_${to}`).emit("ice-candidate", {
			candidate,
			from,
			orderId,
		});
	});

	// End call
	socket.on("end-call", ({ to, from, orderId }) => {
		io.to(`user_${to}`).emit("call-ended", {
			from,
			orderId,
		});
	});

	// Reject call
	socket.on("reject-call", ({ to, from, orderId }) => {
		io.to(`user_${to}`).emit("call-rejected", {
			from,
			orderId,
		});
	});

	socket.on("disconnect", () => {
		if (socket.userId) {
			// Notify others that user is offline
			socket.broadcast.emit("user-offline", { userId: socket.userId });
		}
	});
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
