// controllers/storeController.js - Fixed with case-insensitive search

import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";

export const getStoreByHandle = async (req, res) => {
	try {
		const { handle } = req.params;
		const normalizedHandle = handle.toLowerCase().trim();

		console.log(`🔍 Looking for store with handle: ${normalizedHandle}`);

		// ✅ Try case-insensitive search first
		let cook = await CookProfile.findOne({
			storeHandle: { $regex: new RegExp(`^${normalizedHandle}$`, "i") },
		});

		// ✅ If not found, try exact match
		if (!cook) {
			cook = await CookProfile.findOne({
				storeHandle: normalizedHandle,
			});
		}

		// ✅ If still not found, try to find any with similar handle
		if (!cook) {
			const allStores = await CookProfile.find(
				{},
				{ storeHandle: 1, storeName: 1 },
			);
			console.log(
				"📋 Available stores:",
				allStores.map((s) => s.storeHandle),
			);

			// Try to find by storeName as fallback
			cook = await CookProfile.findOne({
				storeName: { $regex: new RegExp(normalizedHandle, "i") },
			});
		}

		if (!cook) {
			console.log(`❌ Store not found for handle: ${normalizedHandle}`);
			return res.status(404).json({
				success: false,
				message: "Store not found",
				availableHandles: await CookProfile.find(
					{},
					{ storeHandle: 1, _id: 0 },
				),
			});
		}

		console.log(`✅ Store found: ${cook.storeName} (${cook.storeHandle})`);

		// ✅ Get the userId properly
		const userId = cook.userId;

		// Check if store is available
		if (!cook.isAvailable) {
			return res.status(403).json({
				success: false,
				message: "Store is currently paused",
				isAvailable: false,
			});
		}

		if (!cook.isApproved) {
			return res.status(403).json({
				success: false,
				message: "Store is pending approval",
				isApproved: false,
			});
		}

		// Increment view count
		await CookProfile.updateOne(
			{ _id: cook._id },
			{
				$inc: { viewsThisWeek: 1 },
				$push: {
					viewsHistory: {
						$each: [{ date: new Date(), count: 1 }],
						$slice: -30,
					},
				},
			},
		);

		// ✅ Get products using the correct userId
		const products = await Meal.find({
			cookId: userId,
			isAvailable: true,
			status: "active",
		}).sort({ createdAt: -1 });

		console.log(`📦 Found ${products.length} products for store`);

		// ✅ Build store info
		const storeInfo = {
			id: cook._id,
			cookId: userId,
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
			pickupEnabled: cook.pickupEnabled !== false,
			deliveryEnabled: cook.deliveryEnabled || false,
			deliveryFee: cook.deliveryFee || 0,
			preparationDays: cook.preparationDays || 1,
			rating: cook.rating || 0,
			reviewsCount: cook.reviewsCount || 0,
			ordersCount: cook.ordersCount || 0,
			isAvailable: cook.isAvailable,
			isApproved: cook.isApproved,
			fees: {
				addFeesToCustomer: cook.fees?.addFeesToCustomer !== false,
			},
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
				unitDisplayName: p.unitDisplayName,
				unitCount: p.unitCount || 1,
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
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};

// Get store info only (for WhatsApp sharing)
export const getStoreInfo = async (req, res) => {
	try {
		const { handle } = req.params;
		const normalizedHandle = handle.toLowerCase().trim();

		const cook = await CookProfile.findOne({
			storeHandle: normalizedHandle,
		});

		if (!cook) {
			return res.status(404).json({
				success: false,
				message: "Store not found",
			});
		}

		res.json({
			success: true,
			store: {
				id: cook._id,
				cookId: cook.userId,
				storeName: cook.storeName,
				storeLink: cook.storeLink,
				storeDescription: cook.storeDescription,
				profileImage: cook.profileImage,
				rating: cook.rating || 0,
				pickupEnabled: cook.pickupEnabled !== false,
				deliveryEnabled: cook.deliveryEnabled || false,
				deliveryFee: cook.deliveryFee || 0,
				pickupWindow: cook.pickupWindow,
				fees: {
					addFeesToCustomer: cook.fees?.addFeesToCustomer !== false,
				},
			},
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
			return res.status(404).json({
				success: false,
				message: "Store not found",
			});
		}

		// ✅ Use cook.userId directly (it's the user ID, not an object)
		const userId = cook.userId;

		const products = await Meal.find({
			cookId: userId,
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
				unitDisplayName: p.unitDisplayName,
				unitCount: p.unitCount || 1,
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
