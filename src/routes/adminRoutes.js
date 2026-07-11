import express from "express";
import multer from "multer";
import {
	addOrUpdateZone,
	addTeamMember,
	cancelOrder,
	getActiveSessions,
	getAdminProfile,
	getAllMainOrders,
	getAllNotifications,
	getAllOrders,
	getAtRiskOrders,
	getFulfillmentTime,
	getOrderAnalytics,
	getOrderById,
	getOrderChart,
	getOverviewStats,
	getSnapshot,
	getSystemAlerts,
	getTeamMembers,
	getZones,
	globalSearch,
	issueRefund,
	markAllNotificationsAsRead,
	markNotificationAsRead,
	revokeSession,
	updateAdminPassword,
	updateAdminProfile,
} from "../controllers/adminController.js";
import {
	addCookNote,
	adminCreateCook,
	changeCookApprovalStatus,
	creditCookWallet,
	getAllCooks,
	getCookById,
	getCookStats,
	messageCook,
	suspendCook,
} from "../controllers/adminCooksController.js";
import {
	getPaymentById,
	getPayments,
	getPaymentStats,
	refundPayment,
} from "../controllers/adminPaymentController.js";
import {
	addCustomerNote,
	creditCustomerWallet,
	getCustomerById,
	getCustomers,
	messageCustomer,
	toggleCustomerStatus,
} from "../controllers/CustomerController.js";
import { adminCreateMeal } from "../controllers/mealController.js";
import {
	createNotification,
	sendBulkNotification,
	sendPushToAllUsers,
	testPushToToken,
} from "../controllers/notificationController.js";
import adminOnly from "../middleware/admin.js";
import protect from "../middleware/auth.js";
import { seedMealReviews } from "../scripts/seedMeals.js";

const upload = multer({ dest: "uploads/" });
const router = express.Router();

// Become a cook
router.get("/stats/overview", protect, adminOnly, getOverviewStats);
router.get("/stats/orders-chart", protect, adminOnly, getOrderChart);
router.get("/stats/fulfilment", protect, adminOnly, getFulfillmentTime);
router.get("/system-alerts", protect, adminOnly, getSystemAlerts);
router.get("/orders", protect, adminOnly, getAllOrders);
router.get("/orders/analytics", protect, adminOnly, getOrderAnalytics);
router.get("/orders/filter", protect, adminOnly, getAllMainOrders);
router.get("/orders/at-risk", protect, adminOnly, getAtRiskOrders);
router.get("/customers", protect, adminOnly, protect, getCustomers);
// Cook stats
router.get("/cooks/stats", protect, adminOnly, getCookStats);
router.post("/seed/reviews", protect, adminOnly, seedMealReviews);

// Fetch all cooks with filters
router.get("/cooks", protect, adminOnly, getAllCooks);
router.post("/meals/create", protect, adminOnly, adminCreateMeal);
router.get("/notifications", protect, adminOnly, getAllNotifications);
router.get("/snapshot", protect, adminOnly, getSnapshot);
// Stats
router.get("/payments/stats", protect, adminOnly, getPaymentStats);

// List payments
router.get("/payments", protect, adminOnly, getPayments);
router.get("/search", protect, adminOnly, globalSearch);

router.post("/test-push", protect, adminOnly, testPushToToken);
router.post("/send-to-all", protect, adminOnly, sendPushToAllUsers);
router.post("/create", protect, adminOnly, createNotification);
router.post("/bulk", protect, adminOnly, sendBulkNotification);

// Admin Profile
router.get("/profile", protect, adminOnly, getAdminProfile);
router.put("/profile", protect, adminOnly, updateAdminProfile);
router.put("/profile/password", protect, adminOnly, updateAdminPassword);

// Team
router.post("/team", protect, adminOnly, addTeamMember);
router.get("/team", protect, adminOnly, getTeamMembers);

// Sessions
router.get("/sessions", protect, adminOnly, getActiveSessions);
router.delete("/sessions/:sessionId", protect, adminOnly, revokeSession);

// Zones
router.post("/zones", protect, adminOnly, addOrUpdateZone);
router.get("/zones", protect, adminOnly, getZones);

router.patch(
	"/notifications/read-all",
	protect,
	adminOnly,
	markAllNotificationsAsRead,
);
router.patch(
	"/notifications/:id/read",
	protect,
	adminOnly,
	markNotificationAsRead,
);

// Single payment
router.get("/payments/:id", protect, adminOnly, getPaymentById);

// Refund
router.post("/payments/:id/refund", protect, adminOnly, refundPayment);

router.post(
	"/cooks/create",
	protect,
	adminOnly,
	upload.fields([
		{ name: "profilePhoto", maxCount: 1 },
		{ name: "coverPhoto", maxCount: 1 },
		{ name: "kitchenPhotos", maxCount: 3 },
		{ name: "cacImage", maxCount: 1 },
	]),
	adminCreateCook,
);
// Fetch
router.get("/cooks/:cookId", protect, adminOnly, getCookById);

// Message cook
router.post("/cooks/:cookId/message", protect, adminOnly, messageCook);
(adminOnly,
	// Add note to cook
	router.post("/cooks/:cookId/note", protect, adminOnly, addCookNote));

// Change cook status
router.post(
	"/cooks/:cookId/status",
	protect,
	adminOnly,
	changeCookApprovalStatus,
);

router.post("/cooks/:cookId/suspend", protect, adminOnly, suspendCook);

// Credit cook wallet
router.post("/cooks/:cookId/credit", protect, adminOnly, creditCookWallet);
router.post("/customers/:userId/note", protect, adminOnly, addCustomerNote);
router.get("/customer/:userId", protect, adminOnly, getCustomerById);
router.post("/customers/:userId/message", protect, adminOnly, messageCustomer);
router.post(
	"/customers/:userId/credit",
	protect,
	adminOnly,
	creditCustomerWallet,
);
router.post(
	"/customers/:userId/status",
	protect,
	adminOnly,
	toggleCustomerStatus,
);

router.get("/orders/:id", protect, adminOnly, getOrderById);

router.patch("/orders/:id/cancel", protect, adminOnly, cancelOrder);
router.patch("/orders/:id/refund", protect, adminOnly, issueRefund);

export default router;
