// routes/reviewRoutes.js
import express from "express";
import {
	createReview,
	deleteReview,
	getCookReviews,
	getCookReviewsByHandle,
	getMealReviews,
	updateReview,
} from "../controllers/reviewController.js";

const router = express.Router();

// ===== PUBLIC ROUTES (No Auth) =====
router.get("/cook/:cookId", getCookReviews);
// routes/reviewRoutes.js - Add this route

router.get("/meal/:mealId", getMealReviews);
router.get("/cook/handle/:storeHandle", getCookReviewsByHandle);

// ===== AUTHENTICATED ROUTES =====
router.post("/", createReview);
router.put("/:id", updateReview);
router.delete("/:id", deleteReview);

export default router;
