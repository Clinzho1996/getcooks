// controllers/foodCategoryController.js
import cloudinary from "cloudinary";
import dotenv from "dotenv";
import fs from "fs";
import FoodCategory from "../models/FoodCategory.js";

dotenv.config();

// Configure Cloudinary
cloudinary.v2.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

// Create a food category
export const createFoodCategory = async (req, res) => {
	try {
		if (!req.file)
			return res.status(400).json({ message: "Category image is required" });

		const result = await cloudinary.v2.uploader.upload(req.file.path, {
			folder: "getameal/categories",
		});

		// Remove file from server
		fs.unlinkSync(req.file.path);

		const category = new FoodCategory({
			name: req.body.name,
			image: { url: result.secure_url, publicId: result.public_id },
		});

		await category.save();
		res.status(201).json({ message: "Category created", category });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all categories
export const getFoodCategories = async (req, res) => {
	try {
		const categories = await FoodCategory.find().sort({ name: 1 });
		res.json(categories);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};
