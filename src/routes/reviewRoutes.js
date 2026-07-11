import express from "express";

import {
	createReview,
	getCookReviews,
	getMealReviews,
	updateReview,
} from "../controllers/reviewController.js";

import protect from "../middleware/auth.js";

const router = express.Router();

router.post("/", protect, createReview);

router.put("/:id", protect, updateReview);

router.get("/meal/:mealId", getMealReviews);

router.get("/cook/:cookId", getCookReviews);

export default router;
