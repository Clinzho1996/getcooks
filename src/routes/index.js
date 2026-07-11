import express from "express";
import * as auth from "../controllers/authController.js";
import * as call from "../controllers/callController.js";
import * as order from "../controllers/orderController.js";
import * as payment from "../controllers/paymentController.js";
import * as payout from "../controllers/payoutController.js";
import * as upload from "../controllers/uploadController.js";
import * as webhook from "../controllers/webhookController.js";
import * as admin from "../controllers/adminController.js";
import { adminOnly } from "../middleware/admin.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.post("/auth/signup/init", auth.signupInit);
router.post("/auth/signup/verify", auth.signupVerify);
router.post("/auth/signup/complete", auth.signupComplete);
router.post("/auth/login/verify", auth.loginVerify);

router.post("/orders", protect, order.createOrder);

router.post("/refund/:id", protect, payment.refundOrder);
router.post("/payout", protect, payout.requestPayout);

router.post("/upload/signature", protect, upload.getSignature);

router.post("/calls/token", protect, call.generateCallToken);

router.post("/webhooks/paystack", webhook.paystackWebhook);
router.get("/admin/dashboard", protect, adminOnly, admin.getDashboardStats);
router.get("/admin/cooks/pending", protect, adminOnly, admin.getPendingCooks);
router.patch("/admin/cooks/approve/:id", protect, adminOnly, admin.approveCook);
router.patch("/admin/cooks/suspend/:id", protect, adminOnly, admin.suspendCook);
router.post("/admin/refund/:id", protect, adminOnly, admin.forceRefund);

export default router;
