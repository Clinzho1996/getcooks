import express from "express";

import {
	createReview,
	getCookReviews,
	getMealReviews,
	updateReview,
} from "../controllers/reviewController.js";

const router = express.Router();

router.post("/", createReview);

router.put("/:id", updateReview);

router.get("/meal/:mealId", getMealReviews);

router.get("/cook/:cookId", getCookReviews);

export default router;
