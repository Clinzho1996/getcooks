// controllers/cookController.js
import cloudinary from "cloudinary";
import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import Customer from "../models/Customer.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { createAdminNotification } from "../utils/adminNotification.js";

dotenv.config();

// Configure Cloudinary
cloudinary.v2.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

// ============================================
// GET COOK BY ID (Public)
// ============================================
export const getCookById = async (req, res) => {
	try {
		const cookId = req.params.cookId || req.params.id;

		console.log("Looking for cook with ID:", cookId);

		if (!cookId) {
			return res.status(400).json({
				success: false,
				message: "Cook ID is required",
			});
		}

		const cook = await CookProfile.findById(cookId).populate(
			"userId",
			"fullName email phone profileImage isSuspended suspensionReason suspensionNote role",
		);

		if (!cook) {
			return res.status(404).json({
				success: false,
				message: "Cook not found",
			});
		}

		console.log("Found cook:", cook._id);

		// Get meals
		const meals = await Meal.find({ cookId: cook.userId?._id || cook.userId })
			.select(
				"name description price images category status portionsRemaining portionsTotal createdAt cookingDate pickupWindow deliveryRegions quantityLabel unitsPerQuantity isAvailable",
			)
			.sort({ createdAt: -1 })
			.populate("category", "name image");

		const formattedMeals = meals.map((meal) => ({
			_id: meal._id,
			name: meal.name,
			description: meal.description,
			category: meal.category,
			price: meal.price,
			customerPrice: meal.customerPrice,
			images: meal.images || [],
			status: meal.status,
			isAvailable: meal.isAvailable,
			portionsRemaining: meal.portionsRemaining,
			portionsTotal: meal.portionsTotal,
			quantityLabel: meal.quantityLabel,
			unitsPerQuantity: meal.unitsPerQuantity,
			cookingDate: meal.cookingDate,
			pickupWindow: meal.pickupWindow,
			deliveryRegions: meal.deliveryRegions,
			createdAt: meal.createdAt,
		}));

		const totalRevenue = await Order.aggregate([
			{
				$match: {
					cookId: cook.userId?._id || cook.userId,
					paymentStatus: "paid",
				},
			},
			{ $group: { _id: null, total: { $sum: "$totalAmount" } } },
		]);

		const recentOrders = await Order.find({
			cookId: cook.userId?._id || cook.userId,
		})
			.sort({ createdAt: -1 })
			.limit(10)
			.populate("userId", "fullName email phone")
			.select(
				"totalAmount status paymentStatus createdAt customerName customerPhone",
			);

		const cookData = {
			cookId: cook._id,
			userId: cook.userId?._id,

			// Store Information (New fields)
			storeName: cook.storeName,
			storeHandle: cook.storeHandle,
			storeLink: cook.storeLink,
			storeDescription: cook.storeDescription,

			// Personal Information
			firstName: cook.firstName,
			lastName: cook.lastName,
			fullName: `${cook.firstName || ""} ${cook.lastName || ""}`.trim(),
			cookDisplayName: cook.cookDisplayName || cook.storeName,
			email: cook.email,
			phone: cook.phone,
			bio: cook.bio || cook.storeDescription,

			// Images
			profilePhoto: cook.profilePhoto,
			coverPhoto: cook.coverPhoto,
			kitchenPhotos: cook.kitchenPhotos,

			// Location Information
			location: cook.location,
			address: cook.cookAddress || cook.kitchenAddress,
			coordinates: cook.location?.coordinates || null,
			state: cook.state || cook.location?.state || null,
			region: cook.location?.region || null,

			// Pickup & Delivery Settings
			pickupWindow: cook.pickupWindow,
			deliveryEnabled: cook.deliveryEnabled || false,
			deliveryFee: cook.deliveryFee || 0,
			preparationDays: cook.preparationDays || 1,

			// Professional Details
			experience: cook.cookingExperience,
			availablePickup: cook.availablePickup,
			schedule: cook.schedule,
			availableForCooking: cook.availableForCooking,

			// Status Flags
			isAvailable: cook.isAvailable,
			isApproved: cook.isApproved,
			isSuspended: cook.isSuspended || false,
			termsAccepted: cook.termsAccepted || false,

			// KYC & Compliance
			kycInfo: {
				isRegistered: cook.kycInfo?.isRegistered || false,
				businessType: cook.kycInfo?.businessType,
				cacImage: cook.kycInfo?.cacImage,
				verifiedAt: cook.kycInfo?.verifiedAt,
				status: cook.kycInfo?.status || "pending",
			},
			businessDetails: {
				cac: cook.businessDetails?.cac,
				cookType: cook.businessDetails?.cookType,
				taxId: cook.businessDetails?.taxId,
				businessName: cook.businessDetails?.businessName,
			},

			// Payment Information
			bankDetails: cook.bankDetails,
			walletBalance: cook.walletBalance || 0,

			// Performance Metrics
			rating: cook.rating || 0,
			reviewsCount: cook.reviewsCount || 0,
			ordersCount: cook.ordersCount || 0,
			totalRevenue: totalRevenue[0]?.total || 0,
			viewsThisWeek: cook.viewsThisWeek || 0,

			// User Reference
			user: cook.userId
				? {
						id: cook.userId._id,
						fullName: cook.userId.fullName,
						email: cook.userId.email,
						phone: cook.userId.phone,
						profileImage: cook.userId.profileImage,
						role: cook.userId.role,
						isSuspended: cook.userId.isSuspended,
					}
				: null,

			createdAt: cook.createdAt,
			updatedAt: cook.updatedAt,
		};

		res.status(200).json({
			success: true,
			cook: cookData,
			meals: {
				list: formattedMeals,
				total: formattedMeals.length,
			},
			recentOrders: {
				list: recentOrders,
				total: recentOrders.length,
			},
		});
	} catch (error) {
		console.error("Error in getCookById:", error);
		res.status(500).json({
			success: false,
			message: "Server error",
			error: error.message,
		});
	}
};

// ============================================
// GET COOK PROFILE (Authenticated)
// ============================================
export const getCookProfile = async (req, res) => {
	try {
		const userId = req.user._id;

		const cook = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage coverImage isSuspended",
		);

		if (!cook) {
			return res.status(404).json({
				success: false,
				message: "Cook profile not found",
			});
		}

		// Get counts
		const productCount = await Meal.countDocuments({ cookId: userId });
		const activeProductCount = await Meal.countDocuments({
			cookId: userId,
			isAvailable: true,
		});
		const customerCount = await Customer.countDocuments({ cookId: userId });
		const orderCount = await Order.countDocuments({ cookId: userId });

		const responseData = {
			success: true,
			cookProfile: {
				id: cook._id,
				userId: cook.userId?._id,
				storeName: cook.storeName,
				storeHandle: cook.storeHandle,
				storeLink: cook.storeLink,
				storeDescription: cook.storeDescription,
				phone: cook.phone,
				email: cook.email,
				state: cook.state,
				kitchenAddress: cook.kitchenAddress,
				pickupLandmark: cook.pickupLandmark,
				pickupWindow: cook.pickupWindow,
				deliveryEnabled: cook.deliveryEnabled,
				deliveryFee: cook.deliveryFee,
				preparationDays: cook.preparationDays,
				profileImage: cook.profileImage,
				coverImage: cook.coverImage,
				isApproved: cook.isApproved,
				isAvailable: cook.isAvailable,
				isSuspended: cook.isSuspended || false,
				rating: cook.rating || 0,
				reviewsCount: cook.reviewsCount || 0,
				ordersCount: cook.ordersCount || 0,
				walletBalance: cook.walletBalance || 0,
				viewsThisWeek: cook.viewsThisWeek || 0,
				bankDetails: cook.bankDetails,
				kycInfo: cook.kycInfo,
				businessDetails: cook.businessDetails,
				termsAccepted: cook.termsAccepted,
				createdAt: cook.createdAt,
				updatedAt: cook.updatedAt,
				stats: {
					products: productCount,
					activeProducts: activeProductCount,
					customers: customerCount,
					orders: orderCount,
				},
			},
			user: {
				id: cook.userId?._id,
				fullName: cook.userId?.fullName,
				email: cook.userId?.email,
				phone: cook.userId?.phone,
				profileImage: cook.userId?.profileImage,
				coverImage: cook.userId?.coverImage,
				isSuspended: cook.userId?.isSuspended,
			},
		};

		res.json(responseData);
	} catch (error) {
		console.error("Error fetching cook profile:", error);
		res.status(500).json({
			success: false,
			message: "Failed to fetch cook profile",
			error: error.message,
		});
	}
};

// ============================================
// UPDATE COOK PROFILE
// ============================================

export const updateCookProfile = async (req, res) => {
	try {
		const userId = req.user.id;
		const updates = req.body;

		// Find user and cook profile
		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		let cookProfile = await CookProfile.findOne({ userId });
		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		// Fields that go to User model
		const userFields = [
			"fullName",
			"phone",
			"bio",
			"profileImage",
			"coverImage",
			"location",
		];

		// Fields that go to CookProfile model
		const cookFields = [
			// Store info
			"storeName",
			"storeHandle",
			"storeLink",
			"storeDescription",
			// Personal
			"firstName",
			"lastName",
			"phone",
			"email",
			"cookDisplayName",
			"profilePhoto",
			"coverPhoto",
			"bio",
			// Bank & Business
			"bankDetails",
			"businessDetails",
			"kycInfo",
			// Location
			"kitchenAddress",
			"pickupLandmark",
			"state",
			"location",
			// Settings
			"pickupWindow",
			"pickupEnabled", // ✅ Added
			"deliveryEnabled",
			"deliveryFee",
			"preparationDays",
			// Images
			"kitchenPhotos",
			// Availability
			"availableForCooking",
			"availablePickup",
			"schedule",
			"isAvailable",
			// Fee settings
			"fees",
		];

		// ✅ If storeHandle is being updated, check availability and update storeLink
		if (updates.storeHandle) {
			const normalizedHandle = updates.storeHandle.toLowerCase().trim();

			// Validate handle format
			const handleRegex = /^[a-zA-Z0-9-]+$/;
			if (!handleRegex.test(normalizedHandle)) {
				return res.status(400).json({
					message:
						"Store handle can only contain letters, numbers, and hyphens",
				});
			}

			// Check if handle is already taken by another cook
			const existingStore = await CookProfile.findOne({
				storeHandle: normalizedHandle,
				_id: { $ne: cookProfile._id },
			});

			if (existingStore) {
				return res.status(409).json({
					message: "Store handle is already taken. Please choose another one.",
					field: "storeHandle",
				});
			}

			updates.storeHandle = normalizedHandle;
			updates.storeLink = `https://getameal-client.vercel.app/${normalizedHandle}`;
		}

		// Update User model (only if provided)
		userFields.forEach((field) => {
			if (updates[field] !== undefined) {
				user[field] = updates[field];
			}
		});

		// Update name fields
		if (updates.firstName) user.firstName = updates.firstName;
		if (updates.lastName) user.lastName = updates.lastName;
		if (updates.firstName && updates.lastName) {
			user.fullName = `${updates.firstName} ${updates.lastName}`;
		} else if (updates.storeName) {
			user.fullName = updates.storeName;
		}
		if (updates.email) user.email = updates.email;
		if (updates.phone) user.phone = updates.phone;
		if (updates.bio) user.bio = updates.bio;

		// Update CookProfile model
		cookFields.forEach((field) => {
			if (updates[field] !== undefined) {
				// Handle fees object specially (merge instead of replace)
				if (field === "fees" && typeof updates[field] === "object") {
					cookProfile.fees = {
						...cookProfile.fees,
						...updates.fees,
					};
				} else {
					cookProfile[field] = updates[field];
				}
			}
		});

		// Handle location separately (GeoJSON format)
		if (updates.location) {
			if (typeof updates.location === "object") {
				cookProfile.location = updates.location;
				user.location = updates.location;
			} else if (updates.latitude && updates.longitude) {
				const locationObj = {
					type: "Point",
					coordinates: [
						parseFloat(updates.longitude),
						parseFloat(updates.latitude),
					],
					address: updates.address || cookProfile.kitchenAddress,
					state: updates.state || cookProfile.state,
					region: updates.region || cookProfile.location?.region,
				};
				cookProfile.location = locationObj;
				user.location = locationObj;
			}
		}

		// Handle address
		if (updates.kitchenAddress) {
			cookProfile.kitchenAddress = updates.kitchenAddress;
			if (cookProfile.location) {
				cookProfile.location.address = updates.kitchenAddress;
			}
		}

		// Handle kitchen photos (array)
		if (updates.kitchenPhotos && Array.isArray(updates.kitchenPhotos)) {
			cookProfile.kitchenPhotos = updates.kitchenPhotos;
		}

		// Save both models
		await user.save();
		await cookProfile.save();

		// Return updated profile
		const updatedCookProfile = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage coverImage",
		);

		res.json({
			success: true,
			message: "Cook profile updated successfully",
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				phone: user.phone,
				bio: user.bio,
				profileImage: user.profileImage,
				coverImage: user.coverImage,
				location: user.location,
			},
			cookProfile: updatedCookProfile,
		});
	} catch (error) {
		console.error("Error updating cook profile:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// UPDATE COOK PROFILE WITH IMAGES
// ============================================
export const updateCookProfileWithImages = async (req, res) => {
	try {
		const userId = req.user.id;
		const updates = req.body;

		const user = await User.findById(userId);
		if (!user) return res.status(404).json({ message: "User not found" });

		let cookProfile = await CookProfile.findOne({ userId });
		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		// Handle file uploads
		const files = req.files || {};

		// Upload new profile photo
		if (files.profilePhoto && files.profilePhoto[0]) {
			const result = await cloudinary.v2.uploader.upload(
				files.profilePhoto[0].path,
				{
					folder: "getameal/cooks/profiles",
					transformation: [{ width: 500, height: 500, crop: "fill" }],
				},
			);
			updates.profilePhoto = result.secure_url;
			updates.profileImage = result.secure_url;
			if (fs.existsSync(files.profilePhoto[0].path)) {
				fs.unlinkSync(files.profilePhoto[0].path);
			}
		}

		// Upload new cover photo
		if (files.coverPhoto && files.coverPhoto[0]) {
			const result = await cloudinary.v2.uploader.upload(
				files.coverPhoto[0].path,
				{
					folder: "getameal/cooks/covers",
					transformation: [{ width: 1200, height: 400, crop: "fill" }],
				},
			);
			updates.coverPhoto = result.secure_url;
			updates.coverImage = result.secure_url;
			if (fs.existsSync(files.coverPhoto[0].path)) {
				fs.unlinkSync(files.coverPhoto[0].path);
			}
		}

		// Upload new kitchen photos
		if (files.kitchenPhotos && files.kitchenPhotos.length > 0) {
			const kitchenPhotoUrls = [];
			for (const file of files.kitchenPhotos) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: "getameal/cooks/kitchens",
					transformation: [{ width: 800, height: 600, crop: "fill" }],
				});
				kitchenPhotoUrls.push(result.secure_url);
				if (fs.existsSync(file.path)) {
					fs.unlinkSync(file.path);
				}
			}
			updates.kitchenPhotos = kitchenPhotoUrls;
		}

		// Update models with the same logic as updateCookProfile
		const userFields = [
			"fullName",
			"phone",
			"bio",
			"profileImage",
			"coverImage",
			"location",
		];
		const cookFields = [
			"storeName",
			"storeDescription",
			"firstName",
			"lastName",
			"phone",
			"email",
			"cookDisplayName",
			"profilePhoto",
			"coverPhoto",
			"bio",
			"bankDetails",
			"businessDetails",
			"kycInfo",
			"kitchenAddress",
			"pickupLandmark",
			"state",
			"location",
			"kitchenPhotos",
			"pickupWindow",
			"deliveryEnabled",
			"deliveryFee",
			"preparationDays",
			"availableForCooking",
			"availablePickup",
			"schedule",
			"isAvailable",
		];

		userFields.forEach((field) => {
			if (updates[field] !== undefined) user[field] = updates[field];
		});

		if (updates.firstName) user.firstName = updates.firstName;
		if (updates.lastName) user.lastName = updates.lastName;
		if (updates.firstName && updates.lastName) {
			user.fullName = `${updates.firstName} ${updates.lastName}`;
		} else if (updates.storeName) {
			user.fullName = updates.storeName;
		}
		if (updates.email) user.email = updates.email;
		if (updates.phone) user.phone = updates.phone;

		cookFields.forEach((field) => {
			if (updates[field] !== undefined) cookProfile[field] = updates[field];
		});

		// Handle location
		if (updates.location) {
			if (typeof updates.location === "object") {
				cookProfile.location = updates.location;
				user.location = updates.location;
			} else if (updates.latitude && updates.longitude) {
				const locationObj = {
					type: "Point",
					coordinates: [
						parseFloat(updates.longitude),
						parseFloat(updates.latitude),
					],
					address: updates.address || cookProfile.kitchenAddress,
					state: updates.state || cookProfile.state,
				};
				cookProfile.location = locationObj;
				user.location = locationObj;
			}
		}

		if (updates.kitchenAddress) {
			cookProfile.kitchenAddress = updates.kitchenAddress;
			if (cookProfile.location) {
				cookProfile.location.address = updates.kitchenAddress;
			}
		}

		await user.save();
		await cookProfile.save();

		const updatedCookProfile = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage coverImage",
		);

		res.json({
			success: true,
			message: "Cook profile updated successfully",
			user: {
				id: user._id,
				fullName: user.fullName,
				email: user.email,
				phone: user.phone,
				profileImage: user.profileImage,
				coverImage: user.coverImage,
			},
			cookProfile: updatedCookProfile,
		});
	} catch (error) {
		console.error("Error updating cook profile:", error);
		// Clean up uploaded files if error occurs
		if (req.files) {
			for (const field in req.files) {
				if (Array.isArray(req.files[field])) {
					for (const file of req.files[field]) {
						if (file && file.path && fs.existsSync(file.path)) {
							fs.unlinkSync(file.path);
						}
					}
				}
			}
		}
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// TOGGLE STORE AVAILABILITY
// ============================================
export const toggleStoreAvailability = async (req, res) => {
	try {
		const userId = req.user._id;
		const { isAvailable } = req.body;

		const cook = await CookProfile.findOneAndUpdate(
			{ userId },
			{ isAvailable },
			{ new: true },
		);

		if (!cook) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		await createAdminNotification({
			title: "Store Availability Toggled",
			body: `${cook.storeName} is now ${isAvailable ? "open" : "paused"} for orders`,
			type: "cook",
			data: { cookId: cook._id, isAvailable },
		});

		res.json({
			success: true,
			message: isAvailable
				? "Store is now open for orders"
				: "Store is now paused",
			isAvailable: cook.isAvailable,
		});
	} catch (error) {
		console.error("Toggle availability error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// GET COOK ANALYTICS
// ============================================
export const getCookAnalytics = async (req, res) => {
	try {
		const userId = req.user._id;
		const cook = await CookProfile.findOne({ userId });

		if (!cook) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		// Get weekly views
		const today = new Date();
		const weekStart = new Date(today);
		weekStart.setDate(today.getDate() - 7);

		const weeklyViews =
			cook.viewsHistory
				?.filter((v) => v.date >= weekStart)
				.reduce((sum, v) => sum + v.count, 0) || 0;

		// Get order statistics
		const orderStats = await Order.aggregate([
			{ $match: { cookId: userId } },
			{
				$group: {
					_id: "$status",
					count: { $sum: 1 },
				},
			},
		]);

		const statusCounts = {
			pending: 0,
			confirmed: 0,
			preparing: 0,
			ready: 0,
			completed: 0,
			cancelled: 0,
		};

		orderStats.forEach((stat) => {
			if (stat._id === "pending") statusCounts.pending = stat.count;
			else if (stat._id === "confirmed") statusCounts.confirmed = stat.count;
			else if (stat._id === "preparing") statusCounts.preparing = stat.count;
			else if (stat._id === "ready") statusCounts.ready = stat.count;
			else if (["picked_up", "delivered"].includes(stat._id)) {
				statusCounts.completed += stat.count;
			} else if (stat._id === "cancelled") statusCounts.cancelled = stat.count;
		});

		// Get revenue
		const revenue = await Order.aggregate([
			{
				$match: {
					cookId: userId,
					paymentStatus: "paid",
				},
			},
			{
				$group: {
					_id: null,
					total: { $sum: "$totalAmount" },
				},
			},
		]);

		// Get monthly revenue
		const monthStart = new Date();
		monthStart.setDate(1);
		monthStart.setHours(0, 0, 0, 0);

		const monthlyRevenue = await Order.aggregate([
			{
				$match: {
					cookId: userId,
					paymentStatus: "paid",
					createdAt: { $gte: monthStart },
				},
			},
			{
				$group: {
					_id: null,
					total: { $sum: "$totalAmount" },
				},
			},
		]);

		res.json({
			success: true,
			analytics: {
				views: {
					thisWeek: weeklyViews,
					total: cook.viewsThisWeek || 0,
				},
				orders: {
					pending: statusCounts.pending,
					confirmed: statusCounts.confirmed,
					preparing: statusCounts.preparing,
					ready: statusCounts.ready,
					completed: statusCounts.completed,
					cancelled: statusCounts.cancelled,
					total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
				},
				revenue: {
					total: revenue[0]?.total || 0,
					thisMonth: monthlyRevenue[0]?.total || 0,
				},
				customers: {
					total: await Customer.countDocuments({ cookId: userId }),
					active: await Customer.countDocuments({
						cookId: userId,
						lastOrderDate: {
							$gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
						},
					}),
				},
				products: {
					total: await Meal.countDocuments({ cookId: userId }),
					active: await Meal.countDocuments({
						cookId: userId,
						isAvailable: true,
					}),
				},
			},
		});
	} catch (error) {
		console.error("Get cook analytics error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// GET ALL COOKS (Admin)
// ============================================
export const getAllCooks = async (req, res) => {
	try {
		const {
			status,
			verification,
			city,
			sortBy,
			dateFrom,
			dateTo,
			isAvailable,
			kycStatus,
			suspensionStatus,
		} = req.query;

		const filter = {};

		if (status) {
			filter.isAvailable = status === "active";
		}

		if (verification) {
			filter.isApproved = verification === "verified";
		}

		if (suspensionStatus === "suspended") {
			filter.isSuspended = true;
		} else if (suspensionStatus === "active") {
			filter.isSuspended = false;
		}

		if (kycStatus) {
			filter["kycInfo.isRegistered"] = kycStatus === "registered";
		}

		if (city) {
			filter["location.address"] = { $regex: city, $options: "i" };
		}

		if (typeof isAvailable !== "undefined") {
			filter.isAvailable = isAvailable === "true";
		}

		if (dateFrom || dateTo) filter.createdAt = {};
		if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
		if (dateTo) filter.createdAt.$lte = new Date(dateTo);

		const sort = {};
		switch (sortBy) {
			case "newest":
				sort.createdAt = -1;
				break;
			case "oldest":
				sort.createdAt = 1;
				break;
			case "mostOrders":
				sort.ordersCount = -1;
				break;
			case "highestRating":
				sort.rating = -1;
				break;
			case "lastActive":
				sort.updatedAt = -1;
				break;
			default:
				sort.createdAt = -1;
		}

		const cooks = await CookProfile.find(filter)
			.sort(sort)
			.populate("userId", "fullName email phone profileImage isSuspended");

		const data = cooks.map((cook) => {
			const displayName =
				cook.storeName ||
				cook.cookDisplayName ||
				cook.cookName ||
				cook.userId?.fullName ||
				"Chef";

			return {
				cookId: cook._id,
				userId: cook.userId?._id,
				storeName: cook.storeName || displayName,
				storeHandle: cook.storeHandle,
				storeLink: cook.storeLink,
				storeDescription: cook.storeDescription,
				firstName: cook.firstName,
				lastName: cook.lastName,
				fullName: cook.userId?.fullName || displayName,
				cookDisplayName: cook.cookDisplayName || displayName,
				email: cook.email || cook.userId?.email,
				phone: cook.phone || cook.userId?.phone,
				bio: cook.bio || cook.storeDescription,
				profilePhoto:
					cook.profilePhoto ||
					cook.userId?.profileImage?.url ||
					cook.userId?.profileImage,
				coverPhoto: cook.coverPhoto,
				kitchenPhotos: cook.kitchenPhotos || [],
				location: cook.location,
				address: cook.kitchenAddress || cook.cookAddress,
				state: cook.state,
				pickupWindow: cook.pickupWindow,
				deliveryEnabled: cook.deliveryEnabled || false,
				deliveryFee: cook.deliveryFee || 0,
				preparationDays: cook.preparationDays || 1,
				experience: cook.cookingExperience,
				isAvailable: cook.isAvailable,
				isApproved: cook.isApproved,
				isSuspended: cook.isSuspended || false,
				availableForCooking: cook.availableForCooking,
				schedule: cook.schedule || [],
				kycInfo: cook.kycInfo || {
					isRegistered: false,
					businessType: "individual",
				},
				businessDetails: cook.businessDetails || {
					cac: { isRegistered: false },
					cookType: "individual",
				},
				bankDetails: cook.bankDetails || null,
				rating: cook.rating || 0,
				reviewsCount: cook.reviewsCount || 0,
				ordersCount: cook.ordersCount || 0,
				walletBalance: cook.walletBalance || 0,
				viewsThisWeek: cook.viewsThisWeek || 0,
				createdAt: cook.createdAt,
				updatedAt: cook.updatedAt,
				user: cook.userId
					? {
							id: cook.userId._id,
							fullName: cook.userId.fullName,
							email: cook.userId.email,
							phone: cook.userId.phone,
							profileImage: cook.userId.profileImage,
							isSuspended: cook.userId.isSuspended,
						}
					: null,
			};
		});

		res.status(200).json({
			success: true,
			count: data.length,
			cooks: data,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ============================================
// CUSTOMER MANAGEMENT
// ============================================

// Get customers
export const getCustomers = async (req, res) => {
	try {
		const userId = req.user._id;
		const { search, limit = 20, page = 1 } = req.query;

		const query = { cookId: userId };

		if (search) {
			query.$or = [
				{ fullName: { $regex: search, $options: "i" } },
				{ phoneNumber: { $regex: search, $options: "i" } },
				{ email: { $regex: search, $options: "i" } },
			];
		}

		const customers = await Customer.find(query)
			.sort({ lastOrderDate: -1 })
			.skip((page - 1) * limit)
			.limit(parseInt(limit));

		const total = await Customer.countDocuments(query);

		res.json({
			success: true,
			customers,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error("Get customers error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Add customer
export const addCustomer = async (req, res) => {
	try {
		const userId = req.user._id;
		const { fullName, phoneNumber, email, notes } = req.body;

		if (!fullName || !phoneNumber) {
			return res.status(400).json({
				message: "Full name and phone number are required",
			});
		}

		// Check if customer already exists
		let customer = await Customer.findOne({
			cookId: userId,
			phoneNumber: phoneNumber.replace(/\D/g, ""),
		});

		if (customer) {
			return res.status(409).json({
				message: "Customer with this phone number already exists",
				customer,
			});
		}

		customer = await Customer.create({
			cookId: userId,
			fullName,
			phoneNumber: phoneNumber.replace(/\D/g, ""),
			email,
			notes,
		});

		res.status(201).json({
			success: true,
			message: "Customer added successfully",
			customer,
		});
	} catch (error) {
		console.error("Add customer error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Get customer order history
export const getCustomerOrderHistory = async (req, res) => {
	try {
		const userId = req.user._id;
		const { customerId } = req.params;

		const customer = await Customer.findOne({
			_id: customerId,
			cookId: userId,
		});

		if (!customer) {
			return res.status(404).json({ message: "Customer not found" });
		}

		const orders = await Order.find({
			cookId: userId,
			customerId: customerId,
		})
			.sort({ createdAt: -1 })
			.limit(50);

		res.json({
			success: true,
			customer,
			orders,
			totalOrders: orders.length,
		});
	} catch (error) {
		console.error("Get customer order history error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Send menu via WhatsApp
export const sendMenuViaWhatsApp = async (req, res) => {
	try {
		const userId = req.user._id;
		const { customerId } = req.params;

		const customer = await Customer.findOne({
			_id: customerId,
			cookId: userId,
		});

		if (!customer) {
			return res.status(404).json({ message: "Customer not found" });
		}

		const cook = await CookProfile.findOne({ userId });
		const storeLink = cook.storeLink;

		const message = `Hi ${customer.fullName}! 🍽️\n\nPlace your order here:\n${storeLink}\n\nThank you for choosing ${cook.storeName}!`;

		const whatsappUrl = `https://wa.me/${customer.phoneNumber}?text=${encodeURIComponent(message)}`;

		res.json({
			success: true,
			whatsappUrl,
			message,
		});
	} catch (error) {
		console.error("Send menu error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// FAVORITE COOKS
// ============================================

export const addFavoriteCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const { cookId } = req.params;

		if (!mongoose.Types.ObjectId.isValid(cookId)) {
			return res.status(400).json({ message: "Invalid cook ID" });
		}

		const cookExists = await User.exists({ _id: cookId, isCook: true });
		if (!cookExists) {
			return res.status(404).json({ message: "Cook not found" });
		}

		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $addToSet: { savedCooks: cookId } },
			{ returnDocument: "after" },
		).select("savedCooks");

		res.json({
			message: "Cook saved to your list",
			savedCooks: updatedUser.savedCooks,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to save cook", error: error.message });
	}
};

export const getFavoriteCooks = async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId).select("savedCooks");

		if (!user || !user.savedCooks || user.savedCooks.length === 0) {
			return res.json([]);
		}

		const favoriteCooks = await getFavoriteCooksHelper(user.savedCooks);
		res.json(favoriteCooks);
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to fetch saved cooks", error: error.message });
	}
};

export const removeFavoriteCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const { cookId } = req.params;

		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $pull: { savedCooks: cookId } },
			{ returnDocument: "after" },
		).select("savedCooks");

		const favoriteCooks = await getFavoriteCooksHelper(updatedUser.savedCooks);

		res.json({
			message: "Cook removed from saved list",
			savedCooks: favoriteCooks,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to remove cook", error: error.message });
	}
};

const getFavoriteCooksHelper = async (favoriteIds) => {
	if (!favoriteIds || favoriteIds.length === 0) return [];

	const ids = favoriteIds.map((id) => new mongoose.Types.ObjectId(id));

	const favoriteUsers = await User.find({
		_id: { $in: ids },
		isCook: true,
	})
		.select("_id fullName profileImage isCook")
		.lean();

	const cookProfiles = await CookProfile.find({
		userId: { $in: ids },
	}).lean();

	return favoriteUsers.map((user) => {
		const profile = cookProfiles.find(
			(p) => p.userId.toString() === user._id.toString(),
		);
		return {
			...user,
			cookProfile: profile || null,
		};
	});
};

// ============================================
// REFERRAL
// ============================================

export const referCook = async (req, res) => {
	try {
		const userId = req.user.id;
		const user = await User.findById(userId);

		if (!user) return res.status(404).json({ message: "User not found" });

		if (!user.referralCode) {
			user.referralCode =
				"REF-" + crypto.randomBytes(3).toString("hex").toUpperCase();
			await user.save();
		}

		res.json({
			message: "Referral code generated",
			referralCode: user.referralCode,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// COOK KYC STATUS
// ============================================

export const getCookKYCStatus = async (req, res) => {
	try {
		const userId = req.user.id;
		let cookProfile = await CookProfile.findOne({ userId });

		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		let needsUpdate = false;
		const updates = {};

		if (
			cookProfile.isApproved &&
			(!cookProfile.kycInfo?.verifiedAt ||
				cookProfile.kycInfo?.status !== "verified")
		) {
			updates["kycInfo.verifiedAt"] = new Date();
			updates["kycInfo.status"] = "verified";
			updates["kycInfo.submittedAt"] =
				cookProfile.kycInfo?.submittedAt || cookProfile.createdAt;
			needsUpdate = true;
		}

		if (cookProfile.kycInfo?.cacImage && !cookProfile.kycInfo?.isRegistered) {
			updates["kycInfo.isRegistered"] = true;
			updates["kycInfo.businessType"] = "business";
			updates["businessDetails.cac.isRegistered"] = true;
			updates["businessDetails.cookType"] = "registered_business";
			needsUpdate = true;
		}

		if (needsUpdate) {
			await CookProfile.updateOne({ _id: cookProfile._id }, { $set: updates });
			cookProfile = await CookProfile.findOne({ userId });
		}

		const kycInfo = cookProfile.kycInfo || {
			isRegistered: false,
			businessType: "individual",
			cacImage: null,
			submittedAt: null,
			verifiedAt: null,
			status: "pending",
		};

		const businessDetails = cookProfile.businessDetails || {
			cac: {
				isRegistered: kycInfo.isRegistered || false,
				registrationNumber: null,
				certificateImage: null,
			},
			cookType: kycInfo.isRegistered
				? "registered_business"
				: kycInfo.businessType || "individual",
			businessName: null,
			taxId: null,
		};

		const isKycComplete = () => {
			if (kycInfo.isRegistered) {
				return !!kycInfo.cacImage;
			} else {
				return !!kycInfo.businessType;
			}
		};

		let kycVerificationStatus = "pending";
		if (kycInfo.verifiedAt) {
			kycVerificationStatus = "verified";
		} else if (kycInfo.rejectedAt) {
			kycVerificationStatus = "rejected";
		} else if (kycInfo.submittedAt) {
			kycVerificationStatus = "submitted";
		}

		if (cookProfile.isApproved && kycVerificationStatus === "pending") {
			kycVerificationStatus = "verified";
		}

		res.json({
			success: true,
			kycInfo: {
				isRegistered: kycInfo.isRegistered || false,
				businessType: kycInfo.businessType || "individual",
				cacImage: kycInfo.cacImage || null,
				submittedAt: kycInfo.submittedAt || null,
				verifiedAt:
					kycInfo.verifiedAt || (cookProfile.isApproved ? new Date() : null),
				status: kycVerificationStatus,
			},
			businessDetails: {
				cac: {
					isRegistered: businessDetails.cac?.isRegistered || false,
					registrationNumber: businessDetails.cac?.registrationNumber || null,
					certificateImage: businessDetails.cac?.certificateImage || null,
				},
				cookType: businessDetails.cookType || "individual",
				businessName: businessDetails.businessName || null,
				taxId: businessDetails.taxId || null,
			},
			isApproved: cookProfile.isApproved || false,
			requiresAdditionalDocs:
				!kycInfo.isRegistered && kycInfo.businessType === "business",
			isKycComplete: isKycComplete(),
			kycStatus: kycVerificationStatus,
		});
	} catch (error) {
		console.error("Error fetching KYC status:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// GET COOK ORDERS
// ============================================

export const getCookOrders = async (req, res) => {
	try {
		const userId = req.user._id;
		const { status, limit = 20, page = 1 } = req.query;

		const query = { cookId: userId };
		if (status) query.status = status;

		const orders = await Order.find(query)
			.sort({ createdAt: -1 })
			.skip((page - 1) * limit)
			.limit(parseInt(limit))
			.populate("customerId", "fullName phoneNumber")
			.populate("items.productId", "name images");

		const total = await Order.countDocuments(query);

		res.json({
			success: true,
			orders,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error("Get cook orders error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// GET ORDER DETAILS
// ============================================

export const getOrderDetails = async (req, res) => {
	try {
		const userId = req.user._id;
		const { orderId } = req.params;

		const order = await Order.findOne({
			_id: orderId,
			cookId: userId,
		})
			.populate("customerId", "fullName phoneNumber email")
			.populate("items.productId", "name images description");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		res.json({
			success: true,
			order,
		});
	} catch (error) {
		console.error("Get order details error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// UPDATE ORDER STATUS
// ============================================

export const updateOrderStatus = async (req, res) => {
	try {
		const userId = req.user._id;
		const { orderId } = req.params;
		const { status, sellerNote } = req.body;

		const order = await Order.findOne({
			_id: orderId,
			cookId: userId,
		});

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		const validStatuses = [
			"pending",
			"confirmed",
			"preparing",
			"ready",
			"picked_up",
			"delivered",
			"cancelled",
		];

		if (!validStatuses.includes(status)) {
			return res.status(400).json({ message: "Invalid status" });
		}

		const oldStatus = order.status;
		order.status = status;
		if (sellerNote) order.sellerNote = sellerNote;

		// If status is ready, set ready date
		if (status === "ready") {
			order.readyAt = new Date();
		}

		await order.save();

		// Send push notification to customer
		// (Implementation depends on your notification system)

		await createAdminNotification({
			title: "Order Status Updated",
			body: `Order #${order._id.toString().slice(-6)} status changed from ${oldStatus} to ${status}`,
			type: "order",
			data: { orderId: order._id, oldStatus, newStatus: status },
		});

		res.json({
			success: true,
			message: `Order status updated to ${status}`,
			order,
		});
	} catch (error) {
		console.error("Update order status error:", error);
		res.status(500).json({ message: error.message });
	}
};

// controllers/cookController.js - Updated updateCookProfile with storeHandle
