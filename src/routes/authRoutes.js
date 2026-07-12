// routes/authRoutes.js - Updated with upload middleware
import express from "express";
import multer from "multer";
import {
	adminLogin,
	adminRequestPasswordReset,
	adminResetPassword,
	checkStoreHandle,
	createAdmin,
	loginInit,
	loginVerify,
	signupComplete,
	signupInit,
	signupVerify,
	socialAuth,
	socialAuthOnboardingComplete,
} from "../controllers/authController.js";
import protect from "../middleware/auth.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// ===== ADMIN ROUTES =====
router.post("/admin/create", createAdmin);
router.post("/admin/login", adminLogin);
router.post("/admin/request-reset", adminRequestPasswordReset);
router.post("/admin/reset-password", adminResetPassword);

// ===== COOK AUTH ROUTES =====
// Email/OTP Signup
router.post("/signup/init", signupInit);
router.post("/signup/verify", signupVerify);
router.post(
	"/signup/complete",
	upload.fields([
		{ name: "profileImage", maxCount: 1 },
		{ name: "coverImage", maxCount: 1 },
	]),
	signupComplete,
);

// Email/OTP Login
router.post("/login/init", loginInit);
router.post("/login/verify", loginVerify);

// Social Auth
router.post("/social-auth", socialAuth);
router.post(
	"/social-auth/onboarding-complete",
	protect,
	socialAuthOnboardingComplete,
);

// Store Handle
router.get("/check-handle/:handle", checkStoreHandle);

export default router;
