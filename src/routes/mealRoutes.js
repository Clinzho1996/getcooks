import express from "express";
import {
	addFavoriteMeal,
	createMeal,
	deleteMeal,
	duplicateMeal,
	getFavoriteMeals,
	getMealById,
	getMeals,
	getMealsByCook,
	getMealsByDateForCook,
	getOrdersByMeal,
	getRelatedMeals,
	removeFavoriteMeal,
	searchMeals,
	updateMeal,
	updateMealStatus,
} from "../controllers/mealController.js";
import protect from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

// Use `upload.array('images', 5)` to allow up to 5 images

router.get("/date", protect, getMealsByDateForCook);
router.get("/favorites", protect, getFavoriteMeals);
router.post("/create", protect, upload.array("images", 5), createMeal);
router.get("/", getMeals);
router.get("/search", searchMeals);
router.get("/:id", getMealById);
// Get meals by cook ID
router.get("/cook/:cookId", getMealsByCook);
router.get("/:id/related", protect, getRelatedMeals);
router.patch("/:id", protect, upload.array("images", 5), updateMeal);
router.patch("/:id/status", protect, updateMealStatus);
router.post("/:id/duplicate", protect, duplicateMeal);
router.delete("/:id", protect, deleteMeal);
router.get("/:id/orders", protect, getOrdersByMeal);
router.post("/favorites/:mealId", protect, addFavoriteMeal);
router.delete("/favorites/:mealId", protect, removeFavoriteMeal);

export default router;
