// routes/payoutRoutes.js
import express from "express";
import {
	getPayoutHistory,
	requestPayout,
	verifyPayoutOTP,
} from "../controllers/payoutController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// POST /api/payouts/request
router.post("/request", protect, requestPayout);
// POST /api/payouts/verify-otp
router.post("/verify-otp", protect, verifyPayoutOTP);
router.get("/history", protect, getPayoutHistory);

export default router;
