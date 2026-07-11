// routes/cookRoutes.js
import express from "express";
import multer from "multer";
import {
	addCustomer,
	getCookAnalytics,
	getCookOrders,
	getCookProfile,
	getCustomerOrderHistory,
	getCustomers,
	getOrderDetails,
	sendMenuViaWhatsApp,
	toggleStoreAvailability,
	updateCookProfile,
	updateCookProfileWithImages,
	updateOrderStatus,
} from "../controllers/cookController.js";
import {
	acceptOrderRequest,
	createCustomOrder,
	declineOrderRequest,
	getOrderRequests,
} from "../controllers/orderController.js";
import {
	createProduct,
	deleteProduct,
	getCookProducts,
	toggleProductAvailability,
	updateProduct,
} from "../controllers/mealController.js";
import protect from "../middleware/auth.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Profile routes
router.get("/profile", protect, getCookProfile);
router.patch("/profile", protect, updateCookProfile);
router.patch(
	"/profile/images",
	protect,
	upload.fields([
		{ name: "profileImage", maxCount: 1 },
		{ name: "coverImage", maxCount: 1 },
	]),
	updateCookProfileWithImages,
);
router.patch("/availability", protect, toggleStoreAvailability);

// Analytics
router.get("/analytics", protect, getCookAnalytics);

// Customer management
router.get("/customers", protect, getCustomers);
router.post("/customers", protect, addCustomer);
router.get("/customers/:customerId/orders", protect, getCustomerOrderHistory);
router.get("/customers/:customerId/whatsapp", protect, sendMenuViaWhatsApp);

// Product management
router.post("/products", protect, upload.array("images", 4), createProduct);
router.get("/products", protect, getCookProducts);
router.patch(
	"/products/:productId",
	protect,
	upload.array("images", 4),
	updateProduct,
);
router.delete("/products/:productId", protect, deleteProduct);
router.patch(
	"/products/:productId/availability",
	protect,
	toggleProductAvailability,
);

// Orders
router.get("/orders", protect, getCookOrders);
router.get("/orders/:orderId", protect, getOrderDetails);
router.patch("/orders/:orderId/status", protect, updateOrderStatus);

// Order requests
router.get("/order-requests", protect, getOrderRequests);
router.post("/order-requests/:requestId/accept", protect, acceptOrderRequest);
router.post("/order-requests/:requestId/decline", protect, declineOrderRequest);
router.post("/order-requests/custom", protect, createCustomOrder);

export default router;
