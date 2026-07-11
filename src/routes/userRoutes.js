// routes/userRoutes.js - Cook Only
import express from "express";
import multer from "multer";
import {
	getMyProfile,
	updateCoverImage,
	updateProfile,
	updateProfileImage,
} from "../controllers/userController.js";
import protect from "../middleware/auth.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" });

// Profile routes
router.get("/me", protect, getMyProfile);
router.patch("/profile", protect, updateProfile);
router.patch(
	"/profile/image",
	protect,
	upload.single("image"),
	updateProfileImage,
);
router.patch("/cover/image", protect, upload.single("image"), updateCoverImage);

export default router;
