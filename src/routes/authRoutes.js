// routes/authRoutes.js
import express from "express";
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

// ===== ADMIN ROUTES =====
router.post("/admin/create", createAdmin);
router.post("/admin/login", adminLogin);
router.post("/admin/request-reset", adminRequestPasswordReset);
router.post("/admin/reset-password", adminResetPassword);

// ===== COOK AUTH ROUTES =====
// Email/OTP Signup
router.post("/signup/init", signupInit);
router.post("/signup/verify", signupVerify);
router.post("/signup/complete", signupComplete);

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
