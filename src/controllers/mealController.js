import cloudinary from "cloudinary";
import dotenv from "dotenv";
import fs from "fs";
import mongoose from "mongoose";
import multer from "multer";
import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import { sendPushToUser } from "../services/pushService.js";
import { createAdminNotification } from "../utils/adminNotification.js";

dotenv.config();

// Configure Cloudinary
cloudinary.v2.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

// Create Meal (Cook Only) with file upload
export const createMeal = async (req, res) => {
	try {
		if (!(req.user.role === "cook" || req.user.isCook)) {
			return res.status(403).json({ message: "Only cooks can create meals" });
		}

		let images = [];
		if (req.files && req.files.length > 0) {
			for (const file of req.files) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: "getameal/meals",
				});
				images.push({ url: result.secure_url, publicId: result.public_id });
				fs.unlinkSync(file.path);
			}
		}

		const meal = new Meal({
			cookId: req.user._id,
			category: req.body.category,
			name: req.body.name,
			description: req.body.description,
			unitsPerQuantity: req.body.unitsPerQuantity,
			price: req.body.price,
			quantityLabel: req.body.quantityLabel,
			portionsTotal: req.body.portionsTotal,
			portionsRemaining: req.body.portionsTotal,
			cookingDate: req.body.cookingDate,
			pickupWindow: req.body.pickupWindow,
			deliveryRegions: req.body.deliveryRegions,
			images,
		});

		await createAdminNotification({
			title: "New Meal Created",
			body: `A new meal was created by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: meal._id },
		});

		await sendPushToUser(
			req.user._id,
			"New Meal Created",
			`A new meal was created by ${req.user.fullName}`,
		);
		await meal.save();
		res.status(201).json({ message: "Meal created successfully", meal });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all meals (public)
export const getMeals = async (req, res) => {
	try {
		const meals = await Meal.find()
			.populate("cookId", "fullName profileImage")
			.sort({ createdAt: -1 })
			.select(
				"name description price unitsPerQuantity images portionsRemaining category cookingDate pickupWindow deliveryRegions quantityLabel",
			);
		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get all meals by cook ID
export const getMealsByCook = async (req, res) => {
	try {
		const cookId = req.params.cookId;

		const cook = await User.findOne({
			_id: cookId,
			$or: [{ role: "cook" }, { isCook: true }],
		});

		if (!cook) return res.status(404).json({ message: "Cook not found" });

		// Get cook profile for additional info
		const cookProfile = await CookProfile.findOne({ userId: cook._id }).select(
			"cookDisplayName cookAddress location profilePhoto coverPhoto bio rating isApproved isAvailable",
		);

		let meals = await Meal.find({ cookId: cook._id })
			.sort({ createdAt: -1 })
			.populate("cookId", "fullName profileImage location");

		// Enrich meals with cook profile data
		meals = meals.map((meal) => {
			const mealObj = meal.toObject();

			// Add cook profile information to each meal
			mealObj.cookDetails = {
				_id: cook._id,
				fullName: cook.fullName,
				email: cook.email,
				phone: cook.phone,
				profileImage: cook.profileImage,
				location: cook.location,
				// Cook profile fields
				cookDisplayName: cookProfile?.cookDisplayName || cook.fullName,
				cookAddress: cookProfile?.cookAddress,
				cookLocation: cookProfile?.location,
				cookProfilePhoto: cookProfile?.profilePhoto || cook.profileImage,
				cookCoverPhoto: cookProfile?.coverPhoto,
				cookBio: cookProfile?.bio,
				cookRating: cookProfile?.rating || 0,
				isApproved: cookProfile?.isApproved || false,
				isAvailable: cookProfile?.isAvailable || false,
			};

			return mealObj;
		});

		res.json({
			success: true,
			count: meals.length,
			cook: {
				_id: cook._id,
				fullName: cook.fullName,
				email: cook.email,
				phone: cook.phone,
				profileImage: cook.profileImage,
				location: cook.location,
				cookDisplayName: cookProfile?.cookDisplayName || cook.fullName,
				cookAddress: cookProfile?.cookAddress,
				cookRating: cookProfile?.rating || 0,
				isApproved: cookProfile?.isApproved || false,
				isAvailable: cookProfile?.isAvailable || false,
			},
			meals: meals,
		});
	} catch (error) {
		console.error("Error in getMealsByCook:", error);
		res.status(500).json({ message: error.message });
	}
};

// Get single meal by ID
export const getMealById = async (req, res) => {
	try {
		const meal = await Meal.findById(req.params.id).populate(
			"cookId",
			"fullName profileImage location",
		);
		if (!meal) return res.status(404).json({ message: "Meal not found" });
		res.json(meal);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Update meal (Cook Only & owner only)
export const updateMeal = async (req, res) => {
	try {
		const meal = await Meal.findById(req.params.id);
		if (!meal) return res.status(404).json({ message: "Meal not found" });

		if (meal.cookId.toString() !== req.user._id.toString()) {
			return res.status(403).json({ message: "Not authorized" });
		}

		// ===== HANDLE IMAGE REPLACEMENT =====
		if (req.files && req.files.length > 0) {
			if (meal.images && meal.images.length > 0) {
				for (const img of meal.images) {
					if (img.publicId) {
						await cloudinary.v2.uploader.destroy(img.publicId);
					}
				}
			}

			let newImages = [];
			for (const file of req.files) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: "getameal/meals",
				});

				newImages.push({
					url: result.secure_url,
					publicId: result.public_id,
				});

				fs.unlinkSync(file.path);
			}

			meal.images = newImages;
		}

		// ===== UPDATE OTHER FIELDS =====
		Object.assign(meal, req.body);

		// ===== HANDLE DELIVERY MODE =====
		if (req.body.deliveryMode) {
			const validModes = ["pickup_only", "delivery_only", "both"];
			if (!validModes.includes(req.body.deliveryMode)) {
				return res.status(400).json({
					message:
						"Invalid deliveryMode. Must be 'pickup_only', 'delivery_only', or 'both'",
				});
			}

			meal.deliveryMode = req.body.deliveryMode;

			// Update deliveryRegions based on mode
			switch (req.body.deliveryMode) {
				case "pickup_only":
					meal.deliveryRegions = [];
					break;
				case "delivery_only":
					// If no regions exist, set default
					if (!meal.deliveryRegions || meal.deliveryRegions.length === 0) {
						meal.deliveryRegions = [
							{ region: "Mainland", fee: 1500 },
							{ region: "Island", fee: 200 },
						];
					}
					break;
				case "both":
					// If no regions exist, set default
					if (!meal.deliveryRegions || meal.deliveryRegions.length === 0) {
						meal.deliveryRegions = [
							{ region: "Mainland", fee: 1500 },
							{ region: "Island", fee: 200 },
						];
					}
					break;
			}
		}

		// ===== HANDLE DELIVERY REGIONS FROM BODY =====
		if (req.body.deliveryRegions !== undefined) {
			if (!req.body.deliveryRegions || req.body.deliveryRegions.length === 0) {
				meal.deliveryRegions = [];
				// If regions are cleared, set mode to pickup_only
				if (meal.deliveryMode !== "pickup_only") {
					meal.deliveryMode = "pickup_only";
				}
			} else {
				let regions = req.body.deliveryRegions;

				if (typeof regions === "string") {
					try {
						regions = JSON.parse(regions);
					} catch (e) {
						return res.status(400).json({
							message: "Invalid deliveryRegions format",
						});
					}
				}

				if (!Array.isArray(regions)) {
					return res.status(400).json({
						message: "deliveryRegions must be an array",
					});
				}

				for (const region of regions) {
					if (!region.region || typeof region.fee !== "number") {
						return res.status(400).json({
							message:
								"Each delivery region must have 'region' (string) and 'fee' (number)",
						});
					}
				}

				meal.deliveryRegions = regions;
			}
		}

		// ===== PORTION LOGIC =====
		if (
			req.body.portionsTotal &&
			req.body.portionsTotal < meal.portionsRemaining
		) {
			meal.portionsRemaining = req.body.portionsTotal;
		}

		await meal.save();

		// ===== DETERMINE AVAILABILITY =====
		const hasDeliveryRegions =
			meal.deliveryRegions && meal.deliveryRegions.length > 0;
		const deliveryMode = meal.deliveryMode || "both";

		res.json({
			message: "Meal updated successfully",
			meal: {
				_id: meal._id,
				name: meal.name,
				description: meal.description,
				price: meal.price,
				images: meal.images,
				status: meal.status,
				deliveryRegions: meal.deliveryRegions,
				deliveryMode: deliveryMode,
				hasDelivery: hasDeliveryRegions,
				availableFor: deliveryMode,
				portionsRemaining: meal.portionsRemaining,
				portionsTotal: meal.portionsTotal,
				cookingDate: meal.cookingDate,
				pickupWindow: meal.pickupWindow,
				quantityLabel: meal.quantityLabel,
				unitsPerQuantity: meal.unitsPerQuantity,
				category: meal.category,
			},
		});
	} catch (error) {
		console.error("Error updating meal:", error);
		res.status(500).json({ message: error.message });
	}
};

// Delete meal (Cook Only & owner only)
export const deleteMeal = async (req, res) => {
	try {
		const meal = await Meal.findById(req.params.id);
		if (!meal) return res.status(404).json({ message: "Meal not found" });

		if (meal.cookId.toString() !== req.user._id.toString()) {
			return res
				.status(403)
				.json({ message: "Not authorized to delete this meal" });
		}

		await meal.deleteOne();

		await createAdminNotification({
			title: "Meal Deleted",
			body: `The meal "${meal.name}" was deleted by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: meal._id },
		});

		await sendPushToUser(
			req.user._id,
			"Meal Deleted",
			`The meal "${meal.name}" was deleted by ${req.user.fullName}`,
		);

		res.json({ message: "Meal deleted successfully" });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const duplicateMeal = async (req, res) => {
	try {
		const { id } = req.params;

		// Validate ID
		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({ message: "Invalid meal ID" });
		}

		// Find original meal
		const originalMeal = await Meal.findById(id);
		if (!originalMeal) {
			return res.status(404).json({ message: "Meal not found" });
		}

		// Ensure only owner can duplicate
		if (originalMeal.cookId.toString() !== req.user._id.toString()) {
			return res.status(403).json({ message: "Not authorized" });
		}

		// Duplicate meal
		const duplicatedMeal = new Meal({
			cookId: originalMeal.cookId,
			category: originalMeal.category,
			name: `${originalMeal.name} (Copy)`,
			description: originalMeal.description,
			unitsPerQuantity: originalMeal.unitsPerQuantity,
			price: originalMeal.price,
			quantityLabel: originalMeal.quantityLabel,
			portionsTotal: originalMeal.portionsTotal,
			portionsRemaining: originalMeal.portionsTotal, // reset
			cookingDate: originalMeal.cookingDate,
			pickupWindow: originalMeal.pickupWindow,
			deliveryRegions: originalMeal.deliveryRegions,
			images: originalMeal.images, // reuse images
			status: "open", // reset status
		});

		await createAdminNotification({
			title: "Meal Duplicated",
			body: `The meal "${originalMeal.name}" was duplicated by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: duplicatedMeal._id },
		});

		await duplicatedMeal.save();

		res.status(201).json({
			message: "Meal duplicated successfully",
			meal: duplicatedMeal,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Search meals
export const searchMeals = async (req, res) => {
	try {
		const { query } = req.query;
		if (!query) return res.status(400).json({ message: "Query is required" });

		const meals = await Meal.aggregate([
			{
				$lookup: {
					from: "foodcategories",
					localField: "category",
					foreignField: "_id",
					as: "categoryInfo",
				},
			},
			{ $unwind: { path: "$categoryInfo", preserveNullAndEmptyArrays: true } },
			{
				$lookup: {
					from: "users",
					localField: "cookId",
					foreignField: "_id",
					as: "cookInfo",
				},
			},
			{ $unwind: "$cookInfo" },
			{
				$match: {
					$or: [
						{ name: { $regex: query, $options: "i" } },
						{ "categoryInfo.name": { $regex: query, $options: "i" } },
						{ "cookInfo.fullName": { $regex: query, $options: "i" } },
					],
				},
			},
			{
				$project: {
					name: 1,
					description: 1,
					price: 1,
					unitsPerQuantity: 1,
					images: 1,
					portionsRemaining: 1,
					"categoryInfo._id": 1,
					"categoryInfo.name": 1,
					"categoryInfo.image": 1,
					"cookInfo._id": 1,
					"cookInfo.fullName": 1,
					"cookInfo.profileImage": 1,
				},
			},
			{ $sort: { createdAt: -1 } },
		]);

		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Get related meals
export const getRelatedMeals = async (req, res) => {
	try {
		const { id } = req.params;
		const meal = await Meal.findById(id);
		if (!meal) return res.status(404).json({ message: "Meal not found" });

		const relatedMeals = await Meal.find({
			_id: { $ne: meal._id },
			status: "open",
			$or: [{ category: meal.category }, { cookId: meal.cookId }],
		})
			.populate("cookId", "fullName profileImage")
			.select(
				"name description price unitsPerQuantity images portionsRemaining category cookingDate quantityLabel",
			)
			.limit(6)
			.sort({ createdAt: -1 });

		res.json({ currentMeal: meal._id, relatedMeals });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// Add meal to favorites
export const addFavoriteMeal = async (req, res) => {
	try {
		const userId = req.user.id;
		const { mealId } = req.params;

		if (!mongoose.Types.ObjectId.isValid(mealId)) {
			return res.status(400).json({ message: "Invalid meal ID" });
		}

		// 1. Verify meal exists
		const mealExists = await Meal.exists({ _id: mealId });
		if (!mealExists) {
			return res.status(404).json({ message: "Meal not found" });
		}

		// 2. Add to favorites array in User model
		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $addToSet: { favorites: mealId } }, // $addToSet prevents duplicate favorites
			{ returnDocument: "after" },
		).select("favorites");

		res.json({
			message: "Meal added to favorites",
			favorites: updatedUser.favorites,
		});
	} catch (error) {
		res
			.status(500)
			.json({ message: "Failed to add favorite meal", error: error.message });
	}
};

// Remove meal from favorites
export const removeFavoriteMeal = async (req, res) => {
	try {
		const userId = req.user.id;
		const { mealId } = req.params;

		const updatedUser = await User.findByIdAndUpdate(
			userId,
			{ $pull: { favorites: mealId } }, // Atomic remove
			{ returnDocument: "after" },
		).select("favorites");

		res.json({
			message: "Meal removed from favorites",
			favorites: updatedUser.favorites,
		});
	} catch (error) {
		res.status(500).json({
			message: "Failed to remove favorite meal",
			error: error.message,
		});
	}
};

// Get all favorite meals
export const getFavoriteMeals = async (req, res) => {
	try {
		const userId = req.user.id;

		// 1. Get the user and just the IDs first
		const user = await User.findById(userId).select("favorites");

		if (!user || !user.favorites || user.favorites.length === 0) {
			return res.json([]); // Return early if no IDs exist
		}

		// 2. Fetch the actual meals from the Meal collection using those IDs
		const favoriteMeals = await Meal.find({
			_id: { $in: user.favorites },
		}).populate("cookId", "fullName profileImage");

		res.json(favoriteMeals);
	} catch (error) {
		res.status(500).json({
			message: "Failed to fetch favorite meals",
			error: error.message,
		});
	}
};

export const getMealsByDateForCook = async (req, res) => {
	try {
		const cookId = req.user._id;
		const { date } = req.query;

		if (!date) return res.status(400).json({ message: "Date is required" });

		const start = new Date(date);
		start.setHours(0, 0, 0, 0);

		const end = new Date(date);
		end.setHours(23, 59, 59, 999);

		const meals = await Meal.find({
			cookId,
			cookingDate: { $gte: start, $lte: end },
		})
			.sort({ cookingDate: 1 })
			.select(
				"name description price images portionsRemaining cookingDate quantityLabel category status", // ✅ include status
			);

		res.json(meals);
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const updateMealStatus = async (req, res) => {
	try {
		const { status } = req.body; // "cooking" or "ready" or "closed" or "open"
		const { id } = req.params;

		if (!["cooking", "ready", "closed", "open"].includes(status)) {
			return res.status(400).json({ message: "Invalid status" });
		}

		const meal = await Meal.findById(id);
		if (!meal) return res.status(404).json({ message: "Meal not found" });

		// Only owner cook can update
		if (meal.cookId.toString() !== req.user._id.toString()) {
			return res.status(403).json({ message: "Not authorized" });
		}

		const oldStatus = meal.status;
		meal.status = status;
		await meal.save();

		// ✅ MAP MEAL STATUS TO ORDER STATUS BASED ON YOUR FLOW
		let orderStatus = "";
		let notificationMessage = "";
		let shouldUpdateOrders = true;

		// Define status transitions
		if (status === "cooking") {
			orderStatus = "cooking";
			notificationMessage = "The cook has started preparing your meal!";
		} else if (status === "ready") {
			orderStatus = "ready";
			notificationMessage =
				"Your meal is ready! It will be out for delivery soon.";
		} else if (status === "closed") {
			orderStatus = "cancelled";
			notificationMessage = "Your meal order has been cancelled.";
		} else if (status === "open") {
			// When going back to open from cooking/ready, revert orders to confirmed
			if (oldStatus === "cooking" || oldStatus === "ready") {
				orderStatus = "confirmed";
				notificationMessage = "The cook has reopened this meal for orders.";
			} else {
				shouldUpdateOrders = false;
			}
		}

		if (shouldUpdateOrders && orderStatus) {
			// Find all orders containing this meal
			const orders = await Order.find({
				"mealItems.mealId": id,
				status: { $nin: ["delivered", "picked_up", "cancelled"] }, // Only update active orders
			}).populate("userId", "fullName email");

			let updatedOrders = 0;

			for (const order of orders) {
				const oldOrderStatus = order.status;

				// Only update if the status change makes sense
				const shouldUpdate =
					(orderStatus === "cooking" && oldOrderStatus === "confirmed") ||
					(orderStatus === "ready" && oldOrderStatus === "cooking") ||
					(orderStatus === "confirmed" &&
						(oldOrderStatus === "cooking" || oldOrderStatus === "ready")) ||
					orderStatus === "cancelled";

				if (shouldUpdate) {
					order.status = orderStatus;
					await order.save();
					updatedOrders++;

					// Send push notification to customer about order status update
					if (order.userId && order.userId._id) {
						await sendPushToUser(
							order.userId._id,
							`Order ${orderStatus.charAt(0).toUpperCase() + orderStatus.slice(1)}`,
							`${notificationMessage} Order #${order._id.toString().slice(-6)}`,
							{
								orderId: order._id,
								status: orderStatus,
								mealId: meal._id,
								mealName: meal.name,
								oldStatus: oldOrderStatus,
							},
						);
					}

					console.log(
						`✅ Order ${order._id} updated from ${oldOrderStatus} to ${orderStatus}`,
					);
				} else {
					console.log(
						`⏭️ Order ${order._id} not updated (${oldOrderStatus} -> ${orderStatus} not allowed)`,
					);
				}
			}

			console.log(
				`✅ Updated ${updatedOrders} orders for meal ${meal.name} to status: ${orderStatus}`,
			);
		}

		await createAdminNotification({
			title: "Meal Status Updated",
			body: `The meal "${meal.name}" status was updated from "${oldStatus}" to "${status}" by ${req.user.fullName}`,
			type: "meal",
			data: { mealId: meal._id, status, oldStatus },
		});

		// Send notification to cook
		await sendPushToUser(
			req.user._id,
			"Meal Status Updated",
			`Your meal "${meal.name}" status was updated from "${oldStatus}" to "${status}"`,
			{
				mealId: meal._id,
				mealName: meal.name,
				oldStatus: oldStatus,
				newStatus: status,
			},
		);

		res.json({
			success: true,
			message: "Meal status updated",
			meal: {
				_id: meal._id,
				name: meal.name,
				status: meal.status,
				oldStatus: oldStatus,
			},
			orderStatusUpdated: orderStatus ? true : false,
			statusFlow: {
				mealStatus: status,
				orderStatus: orderStatus || "No change",
				ordersUpdated: orderStatus ? true : false,
			},
		});
	} catch (error) {
		console.error("Error updating meal status:", error);
		res.status(500).json({ message: error.message });
	}
};

export const getOrdersByMeal = async (req, res) => {
	try {
		const { id } = req.params;

		if (!mongoose.Types.ObjectId.isValid(id)) {
			return res.status(400).json({ message: "Invalid meal ID" });
		}

		const orders = await Order.find({ "mealItems.mealId": id })
			.populate("userId", "fullName email")
			.populate("cookId", "fullName email")
			.sort({ createdAt: -1 });

		res.json({ id, orders });
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

const upload = multer({ dest: "uploads/" });

export const adminCreateMeal = [
	upload.array("images"), // "images" = name of file input in form-data
	async (req, res) => {
		try {
			const {
				cookId,
				category,
				name,
				description,
				unitsPerQuantity,
				price,
				quantityLabel,
				portionsTotal,
				cookingDate,
				pickupWindow,
				deliveryRegions,
			} = req.body;

			if (!cookId || !category || !name || !price) {
				return res
					.status(400)
					.json({ message: "cookId, category, name, and price are required" });
			}

			const cook = await CookProfile.findById(cookId);
			if (!cook) return res.status(404).json({ message: "Cook not found" });

			// Handle images
			let images = [];
			if (req.files && req.files.length > 0) {
				for (const file of req.files) {
					const result = await cloudinary.v2.uploader.upload(file.path, {
						folder: "getameal/meals",
					});
					images.push({ url: result.secure_url, publicId: result.public_id });
					fs.unlinkSync(file.path); // remove local file
				}
			}

			// Handle deliveryRegions safely
			let parsedDeliveryRegions = [];
			if (deliveryRegions) {
				if (typeof deliveryRegions === "string") {
					try {
						parsedDeliveryRegions = JSON.parse(deliveryRegions);
						if (!Array.isArray(parsedDeliveryRegions))
							parsedDeliveryRegions = [parsedDeliveryRegions];
					} catch {
						// fallback: split by comma if it's a comma-separated string
						parsedDeliveryRegions = deliveryRegions
							.split(",")
							.map((s) => s.trim());
					}
				} else if (Array.isArray(deliveryRegions)) {
					parsedDeliveryRegions = deliveryRegions;
				}
			}
			// Create meal
			const meal = new Meal({
				cookId: cook._id,
				category,
				name,
				description,
				unitsPerQuantity: parseInt(unitsPerQuantity),
				price: parseFloat(price),
				quantityLabel,
				portionsTotal: parseInt(portionsTotal),
				portionsRemaining: parseInt(portionsTotal),
				cookingDate: cookingDate ? new Date(cookingDate) : undefined,
				pickupWindow,
				deliveryRegions: parsedDeliveryRegions,
				images,
			});

			await meal.save();

			// Notify admin (or other admins)
			await createAdminNotification({
				title: "New Meal Created by Admin",
				body: `Admin created a meal for cook ${cook.cookName}`,
				type: "meal",
				data: { mealId: meal._id, cookId: cook._id },
			});

			await sendPushToUser(
				req.user._id,
				"New Meal Created",
				`A new meal was created by ${req.user.fullName}`,
			);

			res
				.status(201)
				.json({ message: "Meal created successfully", meal, cookId: cook._id });
		} catch (error) {
			console.error("Admin create meal error:", error);
			res.status(500).json({ message: "Server error", error: error.message });
		}
	},
];

export const createProduct = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			name,
			category,
			whatsIncluded,
			unitType,
			price,
			addOns,
			isAlwaysAvailable,
		} = req.body;

		// Validate required fields
		if (!name || !category || !whatsIncluded || !unitType || !price) {
			return res.status(400).json({
				message:
					"Name, category, whats included, unit type, and price are required",
			});
		}

		// Check if cook exists and is approved
		const cook = await CookProfile.findOne({ userId });
		if (!cook) {
			return res.status(404).json({ message: "Cook profile not found" });
		}
		if (!cook.isApproved) {
			return res.status(403).json({ message: "Store is not approved yet" });
		}

		// Handle images
		let images = [];
		if (req.files && req.files.length > 0) {
			for (const file of req.files) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: `getameal/products/${cook.storeHandle}`,
				});
				images.push({ url: result.secure_url, publicId: result.public_id });
				fs.unlinkSync(file.path);
			}
		}

		// ✅ FIX: Parse price to number first
		const parsedPrice = parseFloat(price);
		if (isNaN(parsedPrice) || parsedPrice <= 0) {
			return res.status(400).json({
				message: "Price must be a valid positive number",
			});
		}

		// Calculate customer price correctly
		const platformFee = parsedPrice * 0.05;
		const subtotal = parsedPrice + platformFee;
		const paystackFee = subtotal * 0.015 + 1; // 1 naira (100 kobo)
		const customerPrice = parseFloat((subtotal + paystackFee).toFixed(2));

		// Parse add-ons
		let parsedAddOns = [];
		if (addOns) {
			try {
				if (typeof addOns === "string") {
					parsedAddOns = JSON.parse(addOns);
				} else if (Array.isArray(addOns)) {
					parsedAddOns = addOns;
				} else if (typeof addOns === "object") {
					parsedAddOns = [addOns];
				}
			} catch (e) {
				// Try cleaning string with single quotes
				try {
					const cleaned = addOns.replace(/'/g, '"');
					parsedAddOns = JSON.parse(cleaned);
				} catch (e2) {
					console.error("Failed to parse addOns:", e2);
					return res.status(400).json({
						message:
							"Invalid addOns format. Expected array of objects with name and price.",
						received: addOns,
					});
				}
			}
		}

		// Validate addOns structure
		if (parsedAddOns && parsedAddOns.length > 0) {
			for (const item of parsedAddOns) {
				if (!item.name || typeof item.price !== "number") {
					return res.status(400).json({
						message: "Each add-on must have a name (string) and price (number)",
						invalidItem: item,
					});
				}
			}
		}

		// Parse isAlwaysAvailable
		const isAlwaysAvailableBool =
			isAlwaysAvailable === "true" ||
			isAlwaysAvailable === true ||
			isAlwaysAvailable === "1";

		const product = await Meal.create({
			cookId: userId,
			name,
			category,
			whatsIncluded,
			unitType,
			price: parsedPrice,
			customerPrice,
			addOns: parsedAddOns,
			images,
			isAvailable: true,
			isAlwaysAvailable: isAlwaysAvailableBool,
			status: "active",
		});

		res.status(201).json({
			success: true,
			message: "Product created successfully",
			product: {
				id: product._id,
				name: product.name,
				category: product.category,
				whatsIncluded: product.whatsIncluded,
				unitType: product.unitType,
				price: product.price,
				customerPrice: product.customerPrice,
				addOns: product.addOns,
				images: product.images,
				isAvailable: product.isAvailable,
				isAlwaysAvailable: product.isAlwaysAvailable,
			},
		});
	} catch (error) {
		console.error("Create product error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Get products for a cook
export const getCookProducts = async (req, res) => {
	try {
		const userId = req.user._id;
		const { category, isAvailable } = req.query;

		const query = { cookId: userId };
		if (category) query.category = category;
		if (isAvailable !== undefined) query.isAvailable = isAvailable === "true";

		const products = await Meal.find(query).sort({ createdAt: -1 });

		res.json({
			success: true,
			products,
			count: products.length,
		});
	} catch (error) {
		console.error("Get cook products error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Update product
// controllers/mealController.js - Fixed updateProduct

export const updateProduct = async (req, res) => {
	try {
		const userId = req.user._id;
		const { productId } = req.params;
		const updates = req.body;

		const product = await Meal.findOne({ _id: productId, cookId: userId });
		if (!product) {
			return res.status(404).json({ message: "Product not found" });
		}

		// Handle new images
		if (req.files && req.files.length > 0) {
			// Delete old images
			for (const img of product.images) {
				if (img.publicId) {
					await cloudinary.v2.uploader.destroy(img.publicId);
				}
			}

			const newImages = [];
			for (const file of req.files) {
				const result = await cloudinary.v2.uploader.upload(file.path, {
					folder: `getameal/products/${product.cookId}`,
				});
				newImages.push({ url: result.secure_url, publicId: result.public_id });
				fs.unlinkSync(file.path);
			}
			updates.images = newImages;
		}

		// If price changes, recalculate customer price
		if (updates.price) {
			// ✅ FIX: Parse price to number
			const parsedPrice = parseFloat(updates.price);
			if (isNaN(parsedPrice) || parsedPrice <= 0) {
				return res.status(400).json({
					message: "Price must be a valid positive number",
				});
			}

			const platformFee = parsedPrice * 0.05;
			const subtotal = parsedPrice + platformFee;
			const paystackFee = subtotal * 0.015 + 1;
			updates.customerPrice = parseFloat((subtotal + paystackFee).toFixed(2));
			updates.price = parsedPrice;
		}

		// Parse add-ons if provided
		if (updates.addOns) {
			try {
				if (typeof updates.addOns === "string") {
					updates.addOns = JSON.parse(updates.addOns);
				}
			} catch (e) {
				try {
					const cleaned = updates.addOns.replace(/'/g, '"');
					updates.addOns = JSON.parse(cleaned);
				} catch (e2) {
					return res.status(400).json({
						message: "Invalid addOns format. Expected array of objects.",
					});
				}
			}
		}

		// Handle isAlwaysAvailable boolean
		if (updates.isAlwaysAvailable !== undefined) {
			updates.isAlwaysAvailable =
				updates.isAlwaysAvailable === "true" ||
				updates.isAlwaysAvailable === true ||
				updates.isAlwaysAvailable === "1";
		}

		// Handle isAvailable boolean
		if (updates.isAvailable !== undefined) {
			updates.isAvailable =
				updates.isAvailable === "true" ||
				updates.isAvailable === true ||
				updates.isAvailable === "1";
		}

		const updatedProduct = await Meal.findByIdAndUpdate(productId, updates, {
			new: true,
		});

		res.json({
			success: true,
			message: "Product updated successfully",
			product: updatedProduct,
		});
	} catch (error) {
		console.error("Update product error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Delete product
export const deleteProduct = async (req, res) => {
	try {
		const userId = req.user._id;
		const { productId } = req.params;

		const product = await Meal.findOne({ _id: productId, cookId: userId });
		if (!product) {
			return res.status(404).json({ message: "Product not found" });
		}

		// Delete images from Cloudinary
		for (const img of product.images) {
			if (img.publicId) {
				await cloudinary.v2.uploader.destroy(img.publicId);
			}
		}

		await product.deleteOne();

		res.json({
			success: true,
			message: "Product deleted successfully",
		});
	} catch (error) {
		console.error("Delete product error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Toggle product availability
export const toggleProductAvailability = async (req, res) => {
	try {
		const userId = req.user._id;
		const { productId } = req.params;
		const { isAvailable } = req.body;

		const product = await Meal.findOneAndUpdate(
			{ _id: productId, cookId: userId },
			{ isAvailable },
			{ new: true },
		);

		if (!product) {
			return res.status(404).json({ message: "Product not found" });
		}

		res.json({
			success: true,
			message: isAvailable
				? "Product is now available"
				: "Product is now unavailable",
			product,
		});
	} catch (error) {
		console.error("Toggle product availability error:", error);
		res.status(500).json({ message: error.message });
	}
};
