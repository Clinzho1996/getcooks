// routes/reviewRoutes.js
import express from "express";
import {
	createReview,
	deleteReview,
	getCookReviews,
	getMealReviews,
	updateReview,
} from "../controllers/reviewController.js";

const router = express.Router();

// ===== PUBLIC ROUTES (No Auth) =====
router.get("/cook/:cookId", getCookReviews);
router.get("/meal/:mealId", getMealReviews);

// ===== AUTHENTICATED ROUTES =====
router.post("/", createReview);
router.put("/:id", updateReview);
router.delete("/:id", deleteReview);

export default router;
