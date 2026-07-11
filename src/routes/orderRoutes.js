// routes/orderRoutes.js
import express from "express";
import {
	acceptOrderRequest,
	createCustomOrder,
	createCustomerOrder,
	declineOrderRequest,
	getCookOrders,
	getCustomerOrderDetails,
	getOrderDetails,
	getOrderRequests,
	handlePaymentCallback,
	paymentRedirect,
	updateOrderStatus,
} from "../controllers/orderController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// ===== PUBLIC ROUTES (No Auth) =====
router.post("/customer", createCustomerOrder);
router.get("/customer/:orderId", getCustomerOrderDetails);

// ✅ Payment routes - Public (No Auth)
router.post("/payment/callback", handlePaymentCallback); // Changed to POST for Paystack webhook
router.get("/payment/redirect", paymentRedirect); // For redirect after payment

// ===== AUTHENTICATED ROUTES =====
router.use(protect);

// Cook orders
router.get("/", getCookOrders);
router.get("/:orderId", getOrderDetails);
router.patch("/:orderId/status", updateOrderStatus);

// Order requests (custom orders)
router.get("/requests", getOrderRequests);
router.post("/requests/:requestId/accept", acceptOrderRequest);
router.post("/requests/:requestId/decline", declineOrderRequest);
router.post("/requests/custom", createCustomOrder);

export default router;
