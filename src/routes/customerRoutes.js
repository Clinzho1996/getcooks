// routes/customerRoutes.js
import express from "express";
import {
  createCustomerOrder,
  getCustomerOrderDetails,
  handlePaymentCallback,
  paymentRedirect,
} from "../controllers/orderController.js";
import {
  getStoreByHandle,
  getStoreInfo,
  getStoreProducts,
} from "../controllers/storeController.js";

const router = express.Router();

// Store pages (public)
router.get("/store/:handle", getStoreByHandle);
router.get("/store/:handle/info", getStoreInfo);
router.get("/store/:handle/products", getStoreProducts);

// Order routes (public - no auth required)
router.post("/orders", createCustomerOrder);
router.get("/orders/:orderId", getCustomerOrderDetails);

// Payment routes
router.get("/payment/redirect", paymentRedirect);
router.get("/payment/callback", handlePaymentCallback);

export default router;