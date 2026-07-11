// controllers/userController.js - Cook Only
import cloudinary from "cloudinary";
import fs from "fs";
import CookProfile from "../models/CookProfile.js";
import User from "../models/User.js";

// Get my profile
export const getMyProfile = async (req, res) => {
	try {
		const user = await User.findById(req.user._id).select("-password");
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		const cookProfile = await CookProfile.findOne({ userId: user._id });

		res.json({
			success: true,
			user,
			cookProfile,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Update profile
export const updateProfile = async (req, res) => {
	try {
		const { fullName, phone, bio } = req.body;
		const user = await User.findById(req.user._id);

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		if (fullName) user.fullName = fullName;
		if (phone) user.phone = phone;
		if (bio) user.bio = bio;

		await user.save();

		res.json({
			success: true,
			message: "Profile updated",
			user,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Update profile image
export const updateProfileImage = async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ message: "No image uploaded" });
		}

		const result = await cloudinary.v2.uploader.upload(req.file.path, {
			folder: "getameal/cooks/profiles",
			transformation: [{ width: 500, height: 500, crop: "fill" }],
		});

		// Update User
		const user = await User.findByIdAndUpdate(
			req.user._id,
			{ profileImage: { url: result.secure_url, publicId: result.public_id } },
			{ new: true },
		);

		// Update CookProfile
		await CookProfile.findOneAndUpdate(
			{ userId: req.user._id },
			{ profileImage: result.secure_url },
		);

		fs.unlinkSync(req.file.path);

		res.json({
			success: true,
			message: "Profile image updated",
			user,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Update cover image
export const updateCoverImage = async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ message: "No image uploaded" });
		}

		const result = await cloudinary.v2.uploader.upload(req.file.path, {
			folder: "getameal/cooks/covers",
			transformation: [{ width: 1200, height: 400, crop: "fill" }],
		});

		// Update User
		const user = await User.findByIdAndUpdate(
			req.user._id,
			{ coverImage: { url: result.secure_url, publicId: result.public_id } },
			{ new: true },
		);

		// Update CookProfile
		await CookProfile.findOneAndUpdate(
			{ userId: req.user._id },
			{ coverImage: result.secure_url },
		);

		fs.unlinkSync(req.file.path);

		res.json({
			success: true,
			message: "Cover image updated",
			user,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};
