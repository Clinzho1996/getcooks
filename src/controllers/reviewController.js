import Review from "../models/Review.js";
import { createAdminNotification } from "../utils/adminNotification.js";

// Create Review
export const createReview = async (req, res) => {
	try {
		const { targetId, targetType, rating, comment } = req.body;

		const exists = await Review.findOne({
			user: req.user._id,
			targetId,
			targetType,
		});

		if (exists)
			return res.status(400).json({
				message: "You already reviewed this item",
			});

		const review = await Review.create({
			user: req.user._id,
			targetId,
			targetType,
			rating,
			comment,
		});

		await createAdminNotification({
			title: "Review Added",
			body: `A new review has been submitted for ${req.user.fullName}`,
			type: "user",
			data: { userId: req.user._id },
		});

		res.json(review);
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

export const updateReview = async (req, res) => {
	try {
		const review = await Review.findById(req.params.id);

		if (!review)
			return res.status(404).json({
				message: "Review not found",
			});

		if (review.user.toString() !== req.user._id.toString())
			return res.status(403).json({
				message: "Not authorized",
			});

		review.rating = req.body.rating || review.rating;

		review.comment = req.body.comment || review.comment;

		await createAdminNotification({
			title: "Review Updated",
			body: `A review has been updated by ${req.user.fullName}`,
			type: "user",
			data: { userId: req.user._id },
		});

		await review.save();

		res.json(review);
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

export const getMealReviews = async (req, res) => {
	try {
		const reviews = await Review.find({
			targetId: req.params.mealId,
			targetType: "meal",
		}).populate("user", "fullName profileImage");

		const avg = reviews.length
			? reviews.reduce((a, b) => a + b.rating, 0) / reviews.length
			: 0;

		res.json({
			averageRating: avg,
			total: reviews.length,
			reviews,
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

export const getCookReviews = async (req, res) => {
	try {
		const reviews = await Review.find({
			targetId: req.params.cookId,
			targetType: "cook",
		}).populate("user", "fullName profileImage");

		const avg = reviews.length
			? reviews.reduce((a, b) => a + b.rating, 0) / reviews.length
			: 0;

		res.json({
			averageRating: avg,
			total: reviews.length,
			reviews,
		});
	} catch (error) {
		res.status(500).json({
			message: error.message,
		});
	}
};

export const addReview = async (req, res) => {
	const review = await Review.create({
		user: req.user._id,
		...req.body,
	});
	res.json(review);

	await createAdminNotification({
		title: "Review Added",
		body: `A new review has been submitted for ${req.user.fullName}`,
		type: "user",
		data: { userId: req.user._id },
	});
};

export const getTargetReviews = async (req, res) => {
	const reviews = await Review.find({ target: req.params.id });
	const avg = reviews.length
		? reviews.reduce((a, b) => a + b.rating, 0) / reviews.length
		: 0;
	res.json({ avg, reviews });
};
