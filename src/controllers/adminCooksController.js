import cloudinary from "cloudinary";
import dotenv from "dotenv";
import fs from "fs";
import { nanoid } from "nanoid";
import { Resend } from "resend";
import CookProfile from "../models/CookProfile.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushService.js";
import { createAdminNotification } from "../utils/adminNotification.js";

dotenv.config();

// Configure Cloudinary
cloudinary.v2.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

// Helper for Resend
let resendInstance = null;

const getResendInstance = () => {
	if (!resendInstance) {
		if (!process.env.RESEND_API_KEY) {
			throw new Error("Missing RESEND_API_KEY environment variable");
		}
		resendInstance = new Resend(process.env.RESEND_API_KEY);
	}
	return resendInstance;
};

// ------------------ Stats ------------------
export const getCookStats = async (req, res) => {
	try {
		const { dateFrom, dateTo, city } = req.query;

		const startDate = dateFrom ? new Date(dateFrom) : new Date();
		startDate.setHours(0, 0, 0, 0);

		const endDate = dateTo ? new Date(dateTo) : new Date();
		endDate.setHours(23, 59, 59, 999);

		// Filter cooks by city if provided
		const cookFilter = {};
		if (city) {
			cookFilter["location.address"] = { $regex: city, $options: "i" };
		}

		const cooks = await CookProfile.find(cookFilter);

		const cookIds = cooks.map((c) => c._id);

		// Orders within the period for these cooks
		const orders = await Order.find({
			cookId: { $in: cookIds },
			createdAt: { $gte: startDate, $lte: endDate },
		});

		const stats = {
			activeCooks: cooks.filter((c) => c.isAvailable).length,
			totalOrders: orders.length,
			amountToday: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
			cancellations: orders.filter((o) => o.status === "cancelled").length,
			refunds: orders.filter((o) => o.paymentStatus === "refunded").length,
			GMV: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0), // gross merchandise value
		};

		res.status(200).json({ stats });
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ------------------ Fetch all cooks ------------------
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

		// Remove population for suspendedBy and reactivatedBy
		const cooks = await CookProfile.find(filter)
			.sort(sort)
			.populate("userId", "fullName email phone profileImage isSuspended");

		const data = cooks.map((cook) => {
			let firstName = cook.firstName;
			let lastName = cook.lastName;
			let fullName = "";

			if (
				firstName &&
				firstName !== "Unknown" &&
				lastName &&
				lastName !== "Cook"
			) {
				fullName = `${firstName} ${lastName}`;
			} else if (cook.cookDisplayName && cook.cookDisplayName !== "undefined") {
				fullName = cook.cookDisplayName;
			} else if (cook.cookName) {
				fullName = cook.cookName;
			} else if (cook.userId?.fullName) {
				fullName = cook.userId.fullName;
			} else {
				fullName = "Chef";
			}

			const displayName =
				cook.cookDisplayName && cook.cookDisplayName !== "undefined"
					? cook.cookDisplayName
					: cook.cookName || fullName;

			let bio = cook.bio;
			if (!bio || bio.includes("undefined")) {
				bio = `${displayName} - Specializing in delicious home-cooked meals.`;
			}

			return {
				cookId: cook._id,
				userId: cook.userId?._id,
				firstName: firstName !== "Unknown" ? firstName : null,
				lastName: lastName !== "Cook" ? lastName : null,
				fullName: fullName,
				cookDisplayName: displayName,
				email:
					cook.email && cook.email !== "undefined"
						? cook.email
						: cook.userId?.email,
				phone:
					cook.phone && cook.phone !== "undefined"
						? cook.phone
						: cook.userId?.phone,
				bio: bio,
				profilePhoto:
					cook.profilePhoto ||
					cook.userId?.profileImage?.url ||
					cook.userId?.profileImage,
				coverPhoto: cook.coverPhoto,
				kitchenPhotos:
					cook.kitchenPhotos && cook.kitchenPhotos.length > 0
						? cook.kitchenPhotos
						: [],
				location: cook.location,
				address: cook.cookAddress,
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

// ------------------ Fetch cook by ID ------------------
export const getCookById = async (req, res) => {
	try {
		const { cookId } = req.params;

		// Remove population for suspendedBy and reactivatedBy
		const cook = await CookProfile.findById(cookId).populate(
			"userId",
			"fullName email phone profileImage isSuspended suspensionReason suspensionNote role",
		);

		if (!cook) {
			return res.status(404).json({ message: "Cook not found" });
		}

		const meals = await Meal.find({ cookId: cook.userId?._id || cook.userId })
			.select(
				"name description price images category status portionsRemaining portionsTotal createdAt cookingDate pickupWindow deliveryRegions quantityLabel unitsPerQuantity",
			)
			.sort({ createdAt: -1 })
			.populate("category", "name image");

		const formattedMeals = meals.map((meal) => ({
			_id: meal._id,
			name: meal.name,
			description: meal.description,
			category: meal.category,
			price: meal.price,
			images: meal.images || [],
			status: meal.status,
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
					paymentStatus: "completed",
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
			.select("orderNumber totalAmount status paymentStatus createdAt");

		const cookData = {
			cookId: cook._id,
			userId: cook.userId?._id,

			// Personal Information
			firstName: cook.firstName,
			lastName: cook.lastName,
			fullName: `${cook.firstName || ""} ${cook.lastName || ""}`.trim(),
			cookDisplayName: cook.cookDisplayName,
			email: cook.email,
			phone: cook.phone,
			bio: cook.bio,

			// Images
			profilePhoto: cook.profilePhoto,
			coverPhoto: cook.coverPhoto,
			kitchenPhotos: cook.kitchenPhotos,

			// Location Information
			location: cook.location,
			address: cook.cookAddress,
			coordinates: cook.location?.coordinates || null,

			// Professional Details
			experience: cook.cookingExperience,
			availablePickup: cook.availablePickup,
			schedule: cook.schedule,
			availableForCooking: cook.availableForCooking,

			// Status Flags
			isAvailable: cook.isAvailable,
			isApproved: cook.isApproved,
			isSuspended: cook.isSuspended || false,

			// KYC & Compliance
			kycInfo: {
				isRegistered: cook.kycInfo?.isRegistered || false,
				businessType: cook.kycInfo?.businessType,
				cacImage: cook.kycInfo?.cacImage,
				verifiedAt: cook.kycInfo?.verifiedAt,
			},
			businessDetails: {
				cac: cook.businessDetails?.cac,
				cookType: cook.businessDetails?.cookType,
				taxId: cook.businessDetails?.taxId,
				businessName: cook.businessDetails?.businessName,
			},

			// Payment Information
			bankDetails: cook.bankDetails,
			walletBalance: cook.walletBalance,

			// Performance Metrics
			rating: cook.rating,
			reviewsCount: cook.reviewsCount,
			ordersCount: cook.ordersCount,
			totalRevenue: totalRevenue[0]?.total || 0,

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
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ------------------ Message cook ------------------
export const messageCook = async (req, res) => {
	try {
		const resend = getResendInstance();
		const { cookId } = req.params;
		const { subject, message } = req.body;
		const cook = await CookProfile.findById(cookId).populate(
			"userId",
			"email fullName",
		);
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		await resend.emails.send({
			from: process.env.EMAIL_FROM,
			to: cook.userId.email,
			subject,
			html: `<h2>Hello ${cook.userId.fullName}</h2><p>${message}</p>`,
		});

		res.status(200).json({ message: "Email sent successfully" });
	} catch (error) {
		console.error(error);
		res
			.status(500)
			.json({ message: "Failed to send email", error: error.message });
	}
};

// ------------------ Add note ------------------
export const addCookNote = async (req, res) => {
	try {
		const { cookId } = req.params;
		const { note } = req.body;
		const cook = await CookProfile.findById(cookId);
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		cook.notes = cook.notes || [];
		cook.notes.push({ note, createdAt: new Date() });
		await cook.save();

		res.status(200).json({ message: "Note added", notes: cook.notes });

		// Optionally, send a push notification to the cook about the new note
		await sendNotification({
			userId: cook.userId,
			title: "New Note from Admin",
			body: "A new note has been added to your profile. Please check your account for details.",
			type: "admin_note",
			data: { cookId: cook._id.toString() },
			// Optionally, you can include the note content in the notification data
		});

		await sendPushToUser(
			cook.userId,
			"New Note from Admin",
			"A new note has been added to your profile. Please check your account for details.",
			{ type: "admin_note", cookId: cook._id.toString() },
		);
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ------------------ Change status ------------------
export const changeCookApprovalStatus = async (req, res) => {
	try {
		const { cookId } = req.params;
		const { action } = req.body;

		const cook = await CookProfile.findById(cookId).populate("userId");
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		let statusMessage = "";
		let notificationTitle = "";
		let notificationBody = "";

		switch (action) {
			case "setActive":
				cook.isApproved = true;
				cook.isAvailable = true;

				// Initialize kycInfo if it doesn't exist
				if (!cook.kycInfo) {
					cook.kycInfo = {};
				}

				// FORCE SET KYC AS VERIFIED WHEN APPROVING
				cook.kycInfo.verifiedAt = new Date();
				cook.kycInfo.verifiedBy = req.user.id;
				cook.kycInfo.status = "verified";
				cook.kycInfo.submittedAt = cook.kycInfo.submittedAt || new Date();

				// If CAC image exists, mark as registered
				if (cook.kycInfo.cacImage) {
					cook.kycInfo.isRegistered = true;
					cook.kycInfo.businessType = "business";

					// Update businessDetails
					if (!cook.businessDetails) cook.businessDetails = {};
					if (!cook.businessDetails.cac) cook.businessDetails.cac = {};
					cook.businessDetails.cac.isRegistered = true;
					cook.businessDetails.cookType = "registered_business";
				} else {
					// For individual cooks without CAC
					cook.kycInfo.isRegistered = cook.kycInfo.isRegistered || false;
					cook.kycInfo.businessType = cook.kycInfo.businessType || "individual";
				}

				// Update user role
				if (cook.userId) {
					await User.findByIdAndUpdate(cook.userId, { role: "cook" });
				}

				statusMessage = "activated";
				notificationTitle = "✅ Cook Profile Approved!";
				notificationBody =
					"Congratulations! Your cook profile has been approved. You can now start creating meals and receiving orders. Your KYC has been verified.";
				break;

			case "setInactive":
				cook.isApproved = false;
				cook.isAvailable = false;
				statusMessage = "deactivated";
				notificationTitle = "⚠️ Cook Profile Deactivated";
				notificationBody =
					"Your cook profile has been deactivated by the admin. Please contact support for more information.";
				break;

			case "verifyKYC":
				if (!cook.kycInfo) cook.kycInfo = {};

				// Check if CAC image exists and update registration status
				if (cook.kycInfo.cacImage) {
					cook.kycInfo.isRegistered = true;
					cook.kycInfo.businessType = "business";

					if (!cook.businessDetails) cook.businessDetails = {};
					if (!cook.businessDetails.cac) cook.businessDetails.cac = {};
					cook.businessDetails.cac.isRegistered = true;
					cook.businessDetails.cookType = "registered_business";
				}

				cook.kycInfo.verifiedAt = new Date();
				cook.kycInfo.verifiedBy = req.user.id;
				cook.kycInfo.status = "verified";
				cook.kycInfo.verificationNotes = req.body.notes || null;
				cook.kycInfo.submittedAt = cook.kycInfo.submittedAt || new Date();

				// Auto-approve if not already approved
				if (!cook.isApproved && req.body.autoApprove !== false) {
					cook.isApproved = true;
					cook.isAvailable = true;
					if (cook.userId) {
						await User.findByIdAndUpdate(cook.userId, { role: "cook" });
					}
				}

				statusMessage = "KYC verified";
				notificationTitle = "📋 KYC Documents Verified";
				notificationBody =
					"Your KYC documents have been verified successfully! Your account is now active.";
				break;

			case "rejectKYC":
				if (!cook.kycInfo) cook.kycInfo = {};
				cook.kycInfo.rejectedAt = new Date();
				cook.kycInfo.rejectedBy = req.user.id;
				cook.kycInfo.rejectionReason =
					req.body.reason || "Documents did not meet requirements";
				cook.kycInfo.status = "rejected";

				statusMessage = "KYC rejected";
				notificationTitle = "❌ KYC Documents Rejected";
				notificationBody = `Your KYC documents have been rejected. Reason: ${cook.kycInfo.rejectionReason}. Please resubmit your documents.`;
				break;

			default:
				return res.status(400).json({
					message:
						"Invalid action. Use: setActive, setInactive, verifyKYC, or rejectKYC",
				});
		}

		await cook.save();

		// Send notifications
		if (cook.userId) {
			try {
				await sendPushToUser(
					cook.userId._id,
					notificationTitle,
					notificationBody,
					{
						type: action,
						cookId: cook._id.toString(),
						isApproved: cook.isApproved,
						kycStatus: cook.kycInfo?.status,
					},
				);
			} catch (pushError) {
				console.error(`❌ Push notification error:`, pushError.message);
			}
		}

		// Create admin notification
		await createAdminNotification({
			title: `Cook ${action}`,
			body: `Cook ${cook.cookDisplayName || cook.cookName} was ${statusMessage} by ${req.user.fullName}`,
			type: "cook_approval",
			data: {
				cookId: cook._id,
				userId: cook.userId?._id,
				action,
				isApproved: cook.isApproved,
				kycVerified: cook.kycInfo?.verifiedAt ? true : false,
			},
		});

		res.status(200).json({
			success: true,
			message: `Cook ${statusMessage} successfully`,
			status: cook.isApproved ? "approved" : "rejected",
			cook: {
				id: cook._id,
				cookDisplayName: cook.cookDisplayName || cook.cookName,
				isApproved: cook.isApproved,
				isAvailable: cook.isAvailable,
				kycInfo: {
					isRegistered: cook.kycInfo?.isRegistered || false,
					businessType: cook.kycInfo?.businessType || "individual",
					cacImage: cook.kycInfo?.cacImage || null,
					submittedAt: cook.kycInfo?.submittedAt,
					verifiedAt: cook.kycInfo?.verifiedAt,
					status: cook.kycInfo?.status || "verified",
				},
				businessDetails: cook.businessDetails,
				updatedAt: cook.updatedAt,
			},
		});
	} catch (error) {
		console.error("Error:", error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

// ===============================
// SUSPEND / UNSUSPEND COOK
// ===============================
export const suspendCook = async (req, res) => {
	const resend = getResendInstance();
	try {
		const { cookId } = req.params;
		const { action, reason, note, notifyCook = true } = req.body;
		// action: suspend | activate

		const cook = await CookProfile.findById(cookId).populate("userId");
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		let statusMessage = "";
		let notificationTitle = "";
		let notificationBody = "";

		if (action === "suspend") {
			if (!reason) {
				return res.status(400).json({ message: "Reason is required" });
			}

			// Suspend the cook profile
			cook.isSuspended = true;
			cook.isAvailable = false; // Also mark as unavailable
			cook.isApproved = false; // Optionally unapprove if needed
			cook.suspensionReason = reason;
			cook.suspensionNote = note || null;
			cook.suspendedAt = new Date();
			cook.suspendedBy = req.user.id;

			// Also update the User model
			if (cook.userId) {
				cook.userId.isSuspended = true;
				cook.userId.suspensionReason = reason;
				cook.userId.suspensionNote = note || null;
				cook.userId.suspendedAt = new Date();
				cook.userId.suspendedBy = req.user.id;
				await cook.userId.save();
			}

			statusMessage = "suspended";
			notificationTitle = "🔒 Your Account Has Been Suspended";
			notificationBody = `Your account has been suspended by the admin. Reason: ${reason}. Please contact support if you believe this is an error.`;

			// Send email if notifyCook is true
			if (notifyCook && cook.userId?.email) {
				const subject = "Your GetAMeal Account Has Been Suspended";
				const message = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #ff4444;">Account Suspension Notice</h2>
            <p>Hello ${cook.userId.fullName || cook.cookDisplayName},</p>
            <p>Your cooking account has been suspended for the following reason:</p>
            <div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <strong>Reason:</strong> ${reason}
              ${note ? `<br><strong>Additional Note:</strong> ${note}` : ""}
            </div>
            <p>During suspension:</p>
            <ul>
              <li>You cannot create new meals</li>
              <li>Your existing meals will be hidden from customers</li>
              <li>You cannot receive new orders</li>
              <li>You cannot access your cook dashboard</li>
            </ul>
            <p>If you believe this is an error, please contact our support team.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #777;">Best regards,<br>GetAMeal Team</p>
          </div>
        `;

				await resend.emails.send({
					from: process.env.EMAIL_FROM,
					to: cook.userId.email,
					subject,
					html: message,
				});
			}
		} else if (action === "activate") {
			// Activate the cook profile
			cook.isSuspended = false;
			cook.isAvailable = true;
			cook.isApproved = true; // Reactivate approval
			cook.suspensionReason = null;
			cook.suspensionNote = null;
			cook.suspendedAt = null;
			cook.suspendedBy = null;
			cook.reactivatedAt = new Date();
			cook.reactivatedBy = req.user.id;

			// Also update the User model
			if (cook.userId) {
				cook.userId.isSuspended = false;
				cook.userId.suspensionReason = null;
				cook.userId.suspensionNote = null;
				cook.userId.suspendedAt = null;
				cook.userId.suspendedBy = null;
				cook.userId.reactivatedAt = new Date();
				await cook.userId.save();
			}

			statusMessage = "activated";
			notificationTitle = "✅ Your Account Has Been Reactivated";
			notificationBody =
				"Your account has been reactivated by the admin. You can now access your account and start cooking again.";

			// Send email notification for reactivation
			if (notifyCook && cook.userId?.email) {
				const subject = "Your GetAMeal Account Has Been Reactivated";
				const message = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4CAF50;">Account Reactivated</h2>
            <p>Hello ${cook.userId.fullName || cook.cookDisplayName},</p>
            <p>Great news! Your cooking account has been reactivated by the admin.</p>
            <p>You can now:</p>
            <ul>
              <li>Create and manage your meals</li>
              <li>Receive orders from customers</li>
              <li>Access your cook dashboard</li>
            </ul>
            <p>Thank you for your patience and understanding.</p>
            <p style="margin-top: 30px; font-size: 12px; color: #777;">Best regards,<br>GetAMeal Team</p>
          </div>
        `;

				await resend.emails.send({
					from: process.env.EMAIL_FROM,
					to: cook.userId.email,
					subject,
					html: message,
				});
			}
		} else {
			return res
				.status(400)
				.json({ message: "Invalid action. Use 'suspend' or 'activate'" });
		}

		// Save the updated cook profile
		await cook.save();

		// Send push notifications
		if (cook.userId && notifyCook) {
			try {
				await sendPushToUser(
					cook.userId._id,
					notificationTitle,
					notificationBody,
					{
						type:
							action === "suspend"
								? "account_suspended"
								: "account_reactivated",
						cookId: cook._id.toString(),
						reason: reason || null,
					},
				);
			} catch (pushError) {
				console.error(
					`❌ Push notification error for cook ${cook._id}:`,
					pushError.message,
				);
				// Don't let push failure break the main flow
			}
		}

		// Create admin notification for audit trail
		await createAdminNotification({
			title:
				action === "suspend"
					? "Cook Account Suspended"
					: "Cook Account Reactivated",
			body: `${cook.cookDisplayName || cook.cookName} was ${statusMessage} by ${req.user.fullName}${reason ? ` Reason: ${reason}` : ""}`,
			type: "cook_suspension",
			data: {
				cookId: cook._id,
				userId: cook.userId?._id,
				action,
				reason,
				note,
			},
		});

		res.status(200).json({
			success: true,
			message: `Cook ${statusMessage} successfully`,
			status: cook.isSuspended ? "suspended" : "active",
			cook: {
				id: cook._id,
				cookDisplayName: cook.cookDisplayName || cook.cookName,
				isSuspended: cook.isSuspended,
				isAvailable: cook.isAvailable,
				isApproved: cook.isApproved,
				suspensionReason: cook.suspensionReason,
				suspensionNote: cook.suspensionNote,
				suspendedAt: cook.suspendedAt,
				reactivatedAt: cook.reactivatedAt,
				user: cook.userId
					? {
							id: cook.userId._id,
							isSuspended: cook.userId.isSuspended,
							fullName: cook.userId.fullName,
							email: cook.userId.email,
						}
					: null,
			},
		});
	} catch (error) {
		console.error("Error in suspendCook:", error);
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// ------------------ Credit cook wallet ------------------
export const creditCookWallet = async (req, res) => {
	try {
		const { cookId } = req.params;
		const { amount, reason, note } = req.body;

		const cook = await CookProfile.findById(cookId);
		if (!cook) return res.status(404).json({ message: "Cook not found" });

		cook.walletBalance += amount;
		await cook.save();

		await WalletTransaction.create({
			cookId: cook._id,
			type: "credit",
			amount,
			reference: reason,
			note,
		});

		// Send push notification to cook about wallet credit
		if (cook.userId) {
			const title = "Wallet Credited";
			const body = `Your wallet has been credited with ${amount} NGN. Reason: ${reason}`;

			try {
				await sendNotification({
					userId: cook.userId,
					title,
					body,
					type: "wallet_credit",
					data: { amount, reason },
				});
			} catch (pushError) {
				console.error(
					`❌ Push notification error for cook ${cook._id}:`,
					pushError.message,
				);
				console.error("Push error details:", pushError);
				// Don't let push failure break the main flow
			}

			try {
				await sendPushToUser(cook.userId, title, body, {
					type: "wallet_credit",
					amount,
					reason,
				});
			} catch (pushError) {
				console.error(
					`❌ Push notification error for cook ${cook._id}:`,
					pushError.message,
				);
				console.error("Push error details:", pushError);
				// Don't let push failure break the main flow
				// Optionally, you could log this to a monitoring service
				// but we won't throw an error here since the wallet credit was successful
				// and we don't want to roll that back just because the notification failed
			}
		}

		res.status(200).json({
			message: "Cook wallet credited",
			walletBalance: cook.walletBalance,
		});
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error", error: error.message });
	}
};

export const adminCreateCook = async (req, res) => {
	const resend = getResendInstance();

	try {
		// Extract form-data fields
		const {
			email,
			firstName,
			lastName,
			phone,
			cookDisplayName,
			bio,
			address,
			latitude,
			longitude,
			startImmediately = true,
			availableDate,
			referralCode,
			notifyUser = true,
			kycInfo,
			businessDetails,
			bankDetails,
		} = req.body;

		// Parse JSON strings if they come as strings
		let parsedKycInfo = kycInfo;
		let parsedBusinessDetails = businessDetails;
		let parsedBankDetails = bankDetails;

		try {
			if (typeof kycInfo === "string") {
				parsedKycInfo = JSON.parse(kycInfo);
			}
			if (typeof businessDetails === "string") {
				parsedBusinessDetails = JSON.parse(businessDetails);
			}
			if (typeof bankDetails === "string") {
				parsedBankDetails = JSON.parse(bankDetails);
			}
		} catch (parseError) {
			return res.status(400).json({
				message:
					"Invalid JSON format in kycInfo, businessDetails, or bankDetails",
				error: parseError.message,
			});
		}

		// Validation
		const requiredFields = [
			"email",
			"firstName",
			"lastName",
			"phone",
			"cookDisplayName",
			"address",
		];

		const missingFields = requiredFields.filter((field) => !req.body[field]);
		if (missingFields.length > 0) {
			return res.status(400).json({
				message: `Missing required fields: ${missingFields.join(", ")}`,
			});
		}

		// Validate KYC info
		if (!parsedKycInfo || parsedKycInfo.isRegistered === undefined) {
			return res.status(400).json({
				message: "KYC registration information is required",
			});
		}

		// If not registered with KYC, business type is required
		if (!parsedKycInfo.isRegistered && !parsedKycInfo.businessType) {
			return res.status(400).json({
				message: "Business type is required when not registered with KYC",
			});
		}

		// Check for uploaded files
		const files = req.files || {};

		// Extract files based on multer configuration
		const profilePhotoFile = files.profilePhoto ? files.profilePhoto[0] : null;
		const coverPhotoFile = files.coverPhoto ? files.coverPhoto[0] : null;
		const kitchenPhotoFiles = files.kitchenPhotos || [];
		const cacImageFile = files.cacImage ? files.cacImage[0] : null;

		// Validate required images for new cook creation
		if (!profilePhotoFile) {
			return res.status(400).json({ message: "Profile photo is required" });
		}
		if (!coverPhotoFile) {
			return res.status(400).json({ message: "Cover photo is required" });
		}
		if (!kitchenPhotoFiles || kitchenPhotoFiles.length !== 3) {
			return res.status(400).json({
				message: "Exactly 3 kitchen photos are required",
				received: kitchenPhotoFiles ? kitchenPhotoFiles.length : 0,
			});
		}

		// If registered with KYC, CAC image is required
		if (parsedKycInfo.isRegistered && !cacImageFile) {
			return res.status(400).json({
				message: "CAC image is required when registered with KYC",
			});
		}

		// Check if user exists
		let user = await User.findOne({ email });
		let plainPassword = null;
		let isNewUser = false;

		if (!user) {
			// Create a new user
			plainPassword = nanoid(10);
			isNewUser = true;

			user = await User.create({
				email,
				firstName,
				lastName,
				fullName: `${firstName} ${lastName}`,
				phone,
				password: plainPassword,
				role: "user",
				isCook: true,
			});
		} else {
			// Update existing user
			user.firstName = firstName;
			user.lastName = lastName;
			user.fullName = `${firstName} ${lastName}`;
			user.phone = phone;
			user.isCook = true;

			// Only generate new password if specified or if user has no password
			if (!user.password || req.body.generateNewPassword === "true") {
				plainPassword = nanoid(10);
				user.password = plainPassword;
			}

			await user.save();
		}

		// Upload images to Cloudinary
		let profilePhotoUrl = null;
		let coverPhotoUrl = null;
		let kitchenPhotoUrls = [];
		let cacImageUrl = null;

		try {
			// Upload profile photo
			if (profilePhotoFile && profilePhotoFile.path) {
				const result = await cloudinary.v2.uploader.upload(
					profilePhotoFile.path,
					{
						folder: "getameal/cooks/profiles",
						transformation: [{ width: 500, height: 500, crop: "fill" }],
					},
				);
				profilePhotoUrl = result.secure_url;
				if (fs.existsSync(profilePhotoFile.path)) {
					fs.unlinkSync(profilePhotoFile.path);
				}
			}

			// Upload cover photo
			if (coverPhotoFile && coverPhotoFile.path) {
				const result = await cloudinary.v2.uploader.upload(
					coverPhotoFile.path,
					{
						folder: "getameal/cooks/covers",
						transformation: [{ width: 1200, height: 400, crop: "fill" }],
					},
				);
				coverPhotoUrl = result.secure_url;
				if (fs.existsSync(coverPhotoFile.path)) {
					fs.unlinkSync(coverPhotoFile.path);
				}
			}

			// Upload kitchen photos
			for (const file of kitchenPhotoFiles) {
				if (file && file.path) {
					const result = await cloudinary.v2.uploader.upload(file.path, {
						folder: "getameal/cooks/kitchens",
						transformation: [{ width: 800, height: 600, crop: "fill" }],
					});
					kitchenPhotoUrls.push(result.secure_url);
					if (fs.existsSync(file.path)) {
						fs.unlinkSync(file.path);
					}
				}
			}

			// Upload CAC image if provided
			if (cacImageFile && cacImageFile.path) {
				const result = await cloudinary.v2.uploader.upload(cacImageFile.path, {
					folder: "getameal/cooks/cac",
				});
				cacImageUrl = result.secure_url;
				if (fs.existsSync(cacImageFile.path)) {
					fs.unlinkSync(cacImageFile.path);
				}
			}
		} catch (uploadError) {
			console.error("Image upload error:", uploadError);
			return res.status(500).json({
				message: "Failed to upload images",
				error: uploadError.message,
			});
		}

		// Create or update cook profile with new schema
		let cookProfile = await CookProfile.findOne({ userId: user._id });

		const cookProfileData = {
			userId: user._id,
			firstName,
			lastName,
			phone,
			email,
			cookDisplayName,
			profilePhoto: profilePhotoUrl,
			coverPhoto: coverPhotoUrl,
			bio: bio || `${cookDisplayName} - Professional cook`,
			cookAddress: address,
			availablePickup: true,
			schedule:
				startImmediately === "true" || startImmediately === true
					? ["Immediate"]
					: availableDate
						? [availableDate]
						: [],
			isApproved: true,
			isAvailable: true,
			kycInfo: {
				isRegistered: parsedKycInfo.isRegistered,
				businessType: parsedKycInfo.businessType || null,
				cacImage: cacImageUrl,
			},
			businessDetails: parsedBusinessDetails || {
				cac: {
					isRegistered: parsedKycInfo.isRegistered,
					registrationNumber: parsedKycInfo.isRegistered
						? parsedBusinessDetails?.cac?.registrationNumber || null
						: null,
					certificateImage: parsedKycInfo.isRegistered
						? parsedBusinessDetails?.cac?.certificateImage || null
						: null,
				},
				cookType: parsedKycInfo.isRegistered
					? "registered_business"
					: parsedKycInfo.businessType || "individual",
			},
			kitchenPhotos: kitchenPhotoUrls,
			location:
				latitude && longitude
					? {
							type: "Point",
							coordinates: [parseFloat(longitude), parseFloat(latitude)],
							address: address,
						}
					: undefined,
			availableForCooking:
				startImmediately === "true" || startImmediately === true
					? new Date()
					: availableDate
						? new Date(availableDate)
						: null,
		};

		// Add bank details if provided
		if (
			parsedBankDetails &&
			parsedBankDetails.accountNumber &&
			parsedBankDetails.bankCode
		) {
			try {
				// Verify bank account with Paystack
				const response = await axios.get(
					`https://api.paystack.co/bank/resolve?account_number=${parsedBankDetails.accountNumber}&bank_code=${parsedBankDetails.bankCode}`,
					{
						headers: {
							Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
						},
					},
				);

				const { account_name } = response.data.data;

				cookProfileData.bankDetails = {
					accountNumber: parsedBankDetails.accountNumber,
					bankCode: parsedBankDetails.bankCode,
					bankName: parsedBankDetails.bankName,
					accountName: account_name,
				};
			} catch (error) {
				console.error("Bank account verification failed:", error.message);
				// Don't fail the creation, just log the error
			}
		}

		if (!cookProfile) {
			cookProfile = await CookProfile.create(cookProfileData);
		} else {
			// Update existing profile
			await CookProfile.updateOne(
				{ userId: user._id },
				{ $set: cookProfileData },
			);
			cookProfile = await CookProfile.findOne({ userId: user._id });
		}

		// Update user's profile image
		if (profilePhotoUrl) {
			user.profileImage = profilePhotoUrl;
			await user.save();
		}

		// Send email to user if notifyUser
		if (notifyUser === "true" || notifyUser === true) {
			const subject = "Your Cook Profile Has Been Created!";
			const message = `
				<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
					<h2 style="color: #4CAF50;">Welcome to GetAMeal, ${firstName}! 🎉</h2>
					
					<p>Your cook profile has been created by the admin. You're now ready to start cooking and earning!</p>
					
					${
						isNewUser || plainPassword
							? `
					<div style="background-color: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
						<h3 style="margin-top: 0;">Your Login Credentials:</h3>
						<p><strong>Email:</strong> ${email}</p>
						<p><strong>Password:</strong> <code style="background-color: #e0e0e0; padding: 3px 8px; border-radius: 3px;">${plainPassword}</code></p>
						<p style="color: #ff6b6b; font-size: 14px;">⚠️ Please change your password after first login for security.</p>
					</div>
					`
							: ""
					}
					
					<div style="margin: 20px 0;">
						<h3>Your Cook Profile Details:</h3>
						<ul style="list-style: none; padding: 0;">
							<li><strong>Display Name:</strong> ${cookDisplayName}</li>
							<li><strong>Kitchen Address:</strong> ${address}</li>
							<li><strong>KYC Status:</strong> ${parsedKycInfo.isRegistered ? "✓ Registered" : "Pending"}</li>
						</ul>
					</div>
					
					<div style="margin: 30px 0; text-align: center;">
						<a href="${process.env.FRONTEND_URL}/login" style="background-color: #4CAF50; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
							Login to Your Account
						</a>
					</div>
					
					<p>Once logged in, you can:</p>
					<ul>
						<li>Create and manage your meals</li>
						<li>View orders from customers</li>
						<li>Update your profile and bank details</li>
						<li>Track your earnings</li>
					</ul>
					
					<p style="margin-top: 30px; font-size: 12px; color: #777;">
						If you have any questions, please contact our support team.
					</p>
				</div>
			`;

			try {
				await resend.emails.send({
					from: process.env.EMAIL_FROM,
					to: email,
					subject,
					html: message,
				});
			} catch (emailError) {
				console.error("Failed to send email:", emailError);
				// Don't fail the creation if email fails
			}
		}

		// Create admin notification
		await createAdminNotification({
			title: "New Cook Created by Admin",
			body: `Admin created a new cook profile for ${firstName} ${lastName}`,
			type: "cook",
			data: {
				cookId: cookProfile._id,
				userId: user._id,
			},
		});

		res.status(201).json({
			message: "Cook profile created successfully",
			user: {
				id: user._id,
				email: user.email,
				fullName: user.fullName,
				isNewUser,
			},
			cookProfile: {
				id: cookProfile._id,
				cookDisplayName: cookProfile.cookDisplayName,
				isApproved: cookProfile.isApproved,
				kycStatus: cookProfile.kycInfo?.isRegistered ? "registered" : "pending",
				profilePhoto: cookProfile.profilePhoto,
				coverPhoto: cookProfile.coverPhoto,
				kitchenPhotos: cookProfile.kitchenPhotos,
			},
			...(plainPassword && { temporaryPassword: plainPassword }), // Only include if generated
		});
	} catch (error) {
		console.error("Admin create cook error:", error);

		// Clean up any uploaded files if there was an error
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

		res.status(500).json({
			message: "Failed to create cook profile",
			error: error.message,
		});
	}
};
