// scripts/fixCookCounts.js

import dotenv from "dotenv";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import Order from "../models/Order.js";
import Review from "../models/Review.js";
import User from "../models/User.js";

dotenv.config();

const fixCookCounts = async () => {
	try {
		// Connect to MongoDB
		await mongoose.connect(process.env.MONGODB_URI);
		console.log("✅ Connected to MongoDB");

		// Get all cook profiles
		const cooks = await CookProfile.find({});
		console.log(`📊 Found ${cooks.length} cooks to update`);

		let totalOrdersUpdated = 0;
		let totalReviewsUpdated = 0;

		for (const cook of cooks) {
			const userId = cook.userId;

			console.log(`\n📝 Updating ${cook.storeName} (${cook.storeHandle})...`);

			// 1. Count completed orders
			const ordersCount = await Order.countDocuments({
				cookId: userId,
				status: { $in: ["delivered", "picked_up"] },
				paymentStatus: "paid",
			});

			// 2. ✅ Get ALL reviews for this cook - both old and new format
			const reviews = await Review.find({
				targetId: cook._id,
				targetType: "cook",
			});

			console.log(`   Found ${reviews.length} reviews in database`);

			// Log review details for debugging
			if (reviews.length > 0) {
				console.log(`   Sample review:`, {
					id: reviews[0]._id,
					hasUser: !!reviews[0].user,
					hasCustomerName: !!reviews[0].customerName,
					hasCustomerPhone: !!reviews[0].customerPhone,
					rating: reviews[0].rating,
				});
			}

			const totalReviews = reviews.length;
			const avgRating =
				totalReviews > 0
					? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
					: 0;

			const roundedRating = Math.round(avgRating * 10) / 10;

			// 3. Update cook profile
			const updateData = {
				ordersCount: ordersCount,
				reviewsCount: totalReviews,
				rating: roundedRating,
			};

			await CookProfile.findByIdAndUpdate(cook._id, {
				$set: updateData,
			});

			// 4. Also update User model if it has these fields
			await User.findByIdAndUpdate(userId, {
				$set: {
					ordersCount: ordersCount,
					reviewsCount: totalReviews,
				},
			});

			console.log(`   ✅ Orders: ${ordersCount}`);
			console.log(`   ✅ Reviews: ${totalReviews}`);
			console.log(`   ✅ Rating: ${roundedRating}`);

			totalOrdersUpdated += ordersCount;
			totalReviewsUpdated += totalReviews;
		}

		console.log(`\n📊 Summary:`);
		console.log(`   ✅ Updated ${cooks.length} cooks`);
		console.log(`   ✅ Total orders: ${totalOrdersUpdated}`);
		console.log(`   ✅ Total reviews: ${totalReviewsUpdated}`);

		console.log("\n✅ All cook profiles updated successfully!");
		process.exit(0);
	} catch (error) {
		console.error("❌ Error:", error);
		process.exit(1);
	}
};

fixCookCounts();
