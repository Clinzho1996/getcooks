// controllers/storeController.js
import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";

export const getStoreByHandle = async (req, res) => {
	try {
		const { handle } = req.params;
		const normalizedHandle = handle.toLowerCase().trim();

		const cook = await CookProfile.findOne({
			storeHandle: normalizedHandle,
		}).populate("userId", "fullName email phone");

		if (!cook) {
			return res.status(404).json({ message: "Store not found" });
		}

		// Check if store is available
		if (!cook.isAvailable) {
			return res.status(403).json({
				message: "Store is currently paused",
				isAvailable: false,
			});
		}

		if (!cook.isApproved) {
			return res.status(403).json({
				message: "Store is pending approval",
				isApproved: false,
			});
		}

		// Increment view count
		const today = new Date();
		today.setHours(0, 0, 0, 0);

		// Update weekly views
		const weekStart = new Date(today);
		weekStart.setDate(today.getDate() - 7);

		await CookProfile.updateOne(
			{ _id: cook._id },
			{
				$inc: { viewsThisWeek: 1 },
				$push: {
					viewsHistory: {
						$each: [{ date: new Date(), count: 1 }],
						$slice: -30, // Keep last 30 days
					},
				},
			},
		);

		// Get products
		const products = await Meal.find({
			cookId: cook.userId._id,
			isAvailable: true,
			status: "active",
		}).sort({ createdAt: -1 });

		// Get store info
		const storeInfo = {
			id: cook._id,
			cookId: cook.userId._id, // ✅ Added cookId
			storeName: cook.storeName,
			storeHandle: cook.storeHandle,
			storeLink: cook.storeLink,
			storeDescription: cook.storeDescription,
			profileImage: cook.profileImage,
			coverImage: cook.coverImage,
			phone: cook.phone,
			email: cook.email,
			state: cook.state,
			kitchenAddress: cook.kitchenAddress,
			pickupLandmark: cook.pickupLandmark,
			pickupWindow: cook.pickupWindow,
			deliveryEnabled: cook.deliveryEnabled,
			deliveryFee: cook.deliveryFee,
			preparationDays: cook.preparationDays,
			rating: cook.rating || 0,
			reviewsCount: cook.reviewsCount || 0,
			ordersCount: cook.ordersCount || 0,
			isAvailable: cook.isAvailable,
			isApproved: cook.isApproved,
		};

		res.json({
			success: true,
			store: storeInfo,
			products: products.map((p) => ({
				id: p._id,
				name: p.name,
				category: p.category,
				whatsIncluded: p.whatsIncluded,
				unitType: p.unitType,
				price: p.price,
				customerPrice: p.customerPrice,
				addOns: p.addOns,
				images: p.images,
				isAvailable: p.isAvailable,
				isAlwaysAvailable: p.isAlwaysAvailable,
			})),
		});
	} catch (error) {
		console.error("Get store error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Get store info only (for WhatsApp sharing)
export const getStoreInfo = async (req, res) => {
	try {
		const { handle } = req.params;
		const normalizedHandle = handle.toLowerCase().trim();

		const cook = await CookProfile.findOne({
			storeHandle: normalizedHandle,
		}).select(
			"storeName storeLink storeDescription profileImage rating deliveryEnabled deliveryFee pickupWindow",
		);

		if (!cook) {
			return res.status(404).json({ message: "Store not found" });
		}

		res.json({
			success: true,
			store: cook,
		});
	} catch (error) {
		console.error("Get store info error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Get store products
export const getStoreProducts = async (req, res) => {
	try {
		const { handle } = req.params;
		const normalizedHandle = handle.toLowerCase().trim();

		const cook = await CookProfile.findOne({ storeHandle: normalizedHandle });
		if (!cook) {
			return res.status(404).json({ message: "Store not found" });
		}

		const products = await Meal.find({
			cookId: cook.userId,
			isAvailable: true,
			status: "active",
		}).sort({ createdAt: -1 });

		res.json({
			success: true,
			products: products.map((p) => ({
				id: p._id,
				name: p.name,
				category: p.category,
				whatsIncluded: p.whatsIncluded,
				unitType: p.unitType,
				price: p.price,
				customerPrice: p.customerPrice,
				addOns: p.addOns,
				images: p.images,
				isAvailable: p.isAvailable,
				isAlwaysAvailable: p.isAlwaysAvailable,
			})),
		});
	} catch (error) {
		console.error("Get store products error:", error);
		res.status(500).json({ message: error.message });
	}
};
