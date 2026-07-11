// routes/foodCategoryRoutes.js
import express from "express";
import {
	createFoodCategory,
	getFoodCategories,
} from "../controllers/foodCategoryController.js";
import protect from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = express.Router();

// Only admin can create a category
router.post("/create", protect, upload.single("image"), createFoodCategory);

// Anyone can fetch categories
router.get("/", getFoodCategories);

export default router;
