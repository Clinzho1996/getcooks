// controllers/reviewController.js - Complete

import CookProfile from "../models/CookProfile.js";
import Notification from "../models/Notification.js";
import Order from "../models/Order.js";
import Review from "../models/Review.js";
import { sendPushToUser } from "../services/pushService.js";
import { createAdminNotification } from "../utils/adminNotification.js";
import {
	formatPhoneForWhatsApp,
	formatPhoneNumber,
} from "../utils/phoneFormatter.js";

// ===== PUBLIC ROUTES (No Auth) =====

// Get reviews for a cook (Public)
export const getCookReviews = async (req, res) => {
	try {
		const { cookId } = req.params;

		// ✅ Find the cook profile first
		const cookProfile = await CookProfile.findById(cookId);
		if (!cookProfile) {
			return res.status(404).json({
				success: false,
				message: "Cook not found",
			});
		}

		const reviews = await Review.find({
			targetId: cookId,
			targetType: "cook",
		}).sort({ createdAt: -1 });

		const avg = reviews.length
			? reviews.reduce((a, b) => a + b.rating, 0) / reviews.length
			: 0;

		res.json({
			success: true,
			averageRating: Math.round(avg * 10) / 10,
			total: reviews.length,
			reviews: reviews.map((r) => ({
				id: r._id,
				rating: r.rating,
				comment: r.comment,
				customerName: r.customerName || "Anonymous",
				createdAt: r.createdAt,
			})),
		});
	} catch (error) {
		console.error("Get cook reviews error:", error);
		res.status(500).json({
			message: error.message,
		});
	}
};

// Get reviews for a meal/product (Public)
export const getMealReviews = async (req, res) => {
	try {
		const { mealId } = req.params;

		const reviews = await Review.find({
			targetId: mealId,
			targetType: "meal",
		}).sort({ createdAt: -1 });

		const avg = reviews.length
			? reviews.reduce((a, b) => a + b.rating, 0) / reviews.length
			: 0;

		res.json({
			success: true,
			averageRating: Math.round(avg * 10) / 10,
			total: reviews.length,
			reviews: reviews.map((r) => ({
				id: r._id,
				rating: r.rating,
				comment: r.comment,
				customerName: r.customerName || "Anonymous",
				createdAt: r.createdAt,
			})),
		});
	} catch (error) {
		console.error("Get meal reviews error:", error);
		res.status(500).json({
			message: error.message,
		});
	}
};

// ===== PUBLIC CREATE REVIEW (No Auth - uses phone number) =====

export const createReview = async (req, res) => {
	try {
		const {
			targetId,
			targetType,
			rating,
			comment,
			customerName,
			customerPhone,
			orderId,
		} = req.body;

		// Validate required fields
		if (!targetId || !targetType || !rating || !customerPhone) {
			return res.status(400).json({
				message:
					"Target ID, target type, rating, and customer phone are required",
			});
		}

		if (!["cook", "meal"].includes(targetType)) {
			return res.status(400).json({
				message: "Target type must be 'cook' or 'meal'",
			});
		}

		if (rating < 1 || rating > 5) {
			return res.status(400).json({
				message: "Rating must be between 1 and 5",
			});
		}

		// ✅ If targetType is "cook", get the cook profile to find the userId
		let cookUserId = targetId;
		let cookProfileId = targetId;

		if (targetType === "cook") {
			// Check if targetId is a cook profile ID or user ID
			const cookProfile = await CookProfile.findById(targetId);

			if (cookProfile) {
				// targetId is a cook profile ID
				cookProfileId = cookProfile._id;
				cookUserId = cookProfile.userId;
			} else {
				// targetId might be a user ID, find the cook profile
				const cookProfileByUser = await CookProfile.findOne({
					userId: targetId,
				});
				if (cookProfileByUser) {
					cookProfileId = cookProfileByUser._id;
					cookUserId = targetId;
				} else {
					return res.status(404).json({
						message: "Cook not found",
					});
				}
			}
		}

		// ✅ Verify the customer has actually ordered from this cook
		if (targetType === "cook") {
			const hasOrdered = await Order.findOne({
				cookId: cookUserId, // Use the user ID for order lookup
				customerPhone: customerPhone.replace(/\D/g, ""),
				paymentStatus: "paid",
				status: { $in: ["delivered", "picked_up"] },
			});

			if (!hasOrdered) {
				return res.status(403).json({
					message: "You can only review cooks you have ordered from",
				});
			}
		}

		// ✅ Check if customer already reviewed this cook (using cook profile ID)
		const exists = await Review.findOne({
			targetId: cookProfileId, // Store the cook profile ID
			targetType,
			customerPhone: customerPhone.replace(/\D/g, ""),
		});

		if (exists) {
			return res.status(400).json({
				message: "You already reviewed this item",
			});
		}

		// Get customer name from order if not provided
		let customerNameToUse = customerName;
		if (!customerNameToUse && orderId) {
			const order = await Order.findById(orderId);
			if (order) {
				customerNameToUse = order.customerName;
			}
		}

		// ✅ Create review with cook profile ID
		const review = await Review.create({
			targetId: cookProfileId, // Store the cook profile ID
			targetType,
			rating,
			comment: comment || "",
			customerName: customerNameToUse || "Anonymous",
			customerPhone: customerPhone.replace(/\D/g, ""),
			cookUserId: cookUserId, // Store user ID for reference
		});

		// ✅ Update cook profile rating
		if (targetType === "cook") {
			const allReviews = await Review.find({
				targetId: cookProfileId,
				targetType: "cook",
			});

			const totalReviews = allReviews.length;
			const avgRating =
				totalReviews > 0
					? allReviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews
					: 0;

			await CookProfile.findByIdAndUpdate(cookProfileId, {
				rating: Math.round(avgRating * 10) / 10,
				reviewsCount: totalReviews,
			});

			// ✅ Send notification to cook about new review
			const cookProfile = await CookProfile.findById(cookProfileId).populate(
				"userId",
				"fullName email phone",
			);

			if (cookProfile && cookProfile.userId) {
				const cookUser = cookProfile.userId;
				const formattedPhone = formatPhoneNumber(cookUser.phone);
				const phoneForWhatsApp = formatPhoneForWhatsApp(cookUser.phone);

				// 1. Create in-app notification
				await Notification.create({
					userId: cookUser._id,
					title: "New Review ⭐",
					body: `${customerNameToUse || "Customer"} left you a ${rating}⭐ review: "${comment || "No comment"}"`,
					type: "review",
					data: {
						reviewId: review._id,
						rating: rating,
						customerName: customerNameToUse || "Customer",
						targetId: cookProfileId,
					},
				});

				// 2. Send push notification if cook has push token
				try {
					await sendPushToUser(
						cookUser._id,
						"New Review ⭐",
						`${customerNameToUse || "Customer"} left you a ${rating}⭐ review!`,
						{
							type: "new_review",
							reviewId: review._id.toString(),
							rating: rating.toString(),
						},
					);
				} catch (pushError) {
					console.error("Push notification error:", pushError.message);
				}

				// 3. Send WhatsApp notification to cook
				const whatsappMessage = `Hi ${cookProfile.storeName}! 🎉

You just received a new review!

⭐ Rating: ${rating}/5
👤 Customer: ${customerNameToUse || "Customer"}
💬 Comment: ${comment || "No comment"}

Keep up the great work! 🍽️`;

				const whatsappUrl = `https://wa.me/${phoneForWhatsApp}?text=${encodeURIComponent(whatsappMessage)}`;

				// Log WhatsApp URL (you can integrate with WhatsApp API here)
				console.log(`📱 WhatsApp notification for cook: ${whatsappUrl}`);
			}
		}

		// Admin notification
		await createAdminNotification({
			title: "New Review",
			body: `${customerNameToUse || "Customer"} left a ${rating}⭐ review`,
			type: "review",
			data: {
				targetId: cookProfileId,
				targetType,
				reviewId: review._id,
			},
		});

		res.status(201).json({
			success: true,
			message: "Review created successfully",
			review: {
				id: review._id,
				rating: review.rating,
				comment: review.comment,
				customerName: review.customerName,
				createdAt: review.createdAt,
			},
		});
	} catch (error) {
		console.error("Create review error:", error);
		res.status(500).json({
			message: error.message,
		});
	}
};

// Update Review (Public - uses phone number)
export const updateReview = async (req, res) => {
	try {
		const { id } = req.params;
		const { rating, comment, customerPhone } = req.body;

		if (!customerPhone) {
			return res.status(400).json({
				message: "Customer phone is required to update review",
			});
		}

		const review = await Review.findById(id);

		if (!review) {
			return res.status(404).json({
				message: "Review not found",
			});
		}

		// Verify ownership via phone number
		if (review.customerPhone !== customerPhone.replace(/\D/g, "")) {
			return res.status(403).json({
				message: "Not authorized to update this review",
			});
		}

		if (rating) {
			if (rating < 1 || rating > 5) {
				return res.status(400).json({
					message: "Rating must be between 1 and 5",
				});
			}
			review.rating = rating;
		}

		if (comment !== undefined) {
			review.comment = comment;
		}

		await review.save();

		// Update cook profile rating
		if (review.targetType === "cook") {
			const allReviews = await Review.find({
				targetId: review.targetId,
				targetType: "cook",
			});

			const avgRating =
				allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

			await CookProfile.findByIdAndUpdate(review.targetId, {
				rating: Math.round(avgRating * 10) / 10,
				reviewsCount: allReviews.length,
			});
		}

		res.json({
			success: true,
			message: "Review updated successfully",
			review: {
				id: review._id,
				rating: review.rating,
				comment: review.comment,
				customerName: review.customerName,
				createdAt: review.createdAt,
				updatedAt: review.updatedAt,
			},
		});
	} catch (error) {
		console.error("Update review error:", error);
		res.status(500).json({
			message: error.message,
		});
	}
};

// Delete Review (Public - uses phone number)
export const deleteReview = async (req, res) => {
	try {
		const { id } = req.params;
		const { customerPhone } = req.body;

		if (!customerPhone) {
			return res.status(400).json({
				message: "Customer phone is required to delete review",
			});
		}

		const review = await Review.findById(id);

		if (!review) {
			return res.status(404).json({
				message: "Review not found",
			});
		}

		// Verify ownership via phone number
		if (review.customerPhone !== customerPhone.replace(/\D/g, "")) {
			return res.status(403).json({
				message: "Not authorized to delete this review",
			});
		}

		await review.deleteOne();

		// Update cook profile rating
		if (review.targetType === "cook") {
			const allReviews = await Review.find({
				targetId: review.targetId,
				targetType: "cook",
			});

			const avgRating =
				allReviews.length > 0
					? allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length
					: 0;

			await CookProfile.findByIdAndUpdate(review.targetId, {
				rating: Math.round(avgRating * 10) / 10,
				reviewsCount: allReviews.length,
			});
		}

		res.json({
			success: true,
			message: "Review deleted successfully",
		});
	} catch (error) {
		console.error("Delete review error:", error);
		res.status(500).json({
			message: error.message,
		});
	}
};
