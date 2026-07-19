// controllers/authController.js - Complete with Social Auth

import bcrypt from "bcryptjs";
import cloudinary from "cloudinary";
import dotenv from "dotenv";
import fs from "fs";
import { verifyFirebaseToken } from "../config/firebase.js";
import CookProfile from "../models/CookProfile.js";
import OTP from "../models/OTP.js";
import User from "../models/User.js";
import { sendOTPEmail } from "../utils/emailService.js";
import { generateOTP } from "../utils/generateOtp.js";
import { generateToken } from "../utils/jwt.js";

dotenv.config();

// Configure Cloudinary
cloudinary.v2.config({
	cloud_name: process.env.CLOUD_NAME,
	api_key: process.env.CLOUD_KEY,
	api_secret: process.env.CLOUD_SECRET,
});

// ===== ADMIN FUNCTIONS =====
export const createAdmin = async (req, res) => {
	try {
		const { email, password, name } = req.body;

		const existing = await User.findOne({ email: email.toLowerCase().trim() });

		if (existing) {
			return res.status(409).json({ message: "Admin already exists" });
		}

		const hashedPassword = await bcrypt.hash(password, 10);

		const admin = await User.create({
			fullName: name,
			email: email.toLowerCase().trim(),
			password: hashedPassword,
			role: "admin",
			isVerified: true,
		});

		res.status(201).json({
			message: "Admin created",
			admin,
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const adminLogin = async (req, res) => {
	try {
		let { email, password } = req.body;

		if (!email || !password) {
			return res.status(400).json({
				message: "Email and password are required",
			});
		}

		email = email.toLowerCase().trim();

		const user = await User.findOne({ email }).select("+password");

		if (!user || user.role !== "admin") {
			return res.status(401).json({
				message: "Invalid credentials",
			});
		}

		const isMatch = await bcrypt.compare(password, user.password);

		if (!isMatch) {
			return res.status(401).json({
				message: "Invalid credentials",
			});
		}

		const token = generateToken(user._id);

		res.status(200).json({
			message: "Admin login successful",
			token,
			user: {
				_id: user._id,
				email: user.email,
				fullName: user.fullName,
				role: user.role,
			},
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

export const adminRequestPasswordReset = async (req, res) => {
	try {
		let { email } = req.body;

		email = email.toLowerCase().trim();

		const user = await User.findOne({ email });

		if (!user || user.role !== "admin") {
			return res.status(404).json({ message: "Admin not found" });
		}

		const code = generateOTP();

		await OTP.create({
			email,
			code,
			expiresAt: Date.now() + 10 * 60 * 1000,
		});

		await sendOTPEmail(email, code);

		res.status(200).json({
			message: "Reset OTP sent to admin email",
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

export const adminResetPassword = async (req, res) => {
	try {
		let { email, otp, newPassword } = req.body;

		email = email.toLowerCase().trim();

		const record = await OTP.findOne({ email, code: otp });

		if (!record) {
			return res.status(400).json({ message: "Invalid OTP" });
		}

		if (record.expiresAt < Date.now()) {
			return res.status(400).json({ message: "OTP expired" });
		}

		const hashedPassword = await bcrypt.hash(newPassword, 10);

		await User.findOneAndUpdate(
			{ email, role: "admin" },
			{ password: hashedPassword },
		);

		res.status(200).json({
			message: "Password reset successful",
		});
	} catch (error) {
		res.status(500).json({ message: error.message });
	}
};

// ===== COOK AUTH FLOW =====

// STEP 1: Signup Init (Email + OTP)
export const signupInit = async (req, res) => {
	try {
		let { email } = req.body;

		if (!email) {
			return res.status(400).json({ message: "Email is required" });
		}

		email = email.toLowerCase().trim();

		// Check if user already exists
		const existingUser = await User.findOne({ email });

		if (existingUser) {
			// If user exists but is not a cook, allow them to proceed
			if (!existingUser.isCook) {
				// Send OTP for verification
				const code = generateOTP();

				await OTP.create({
					email,
					code,
					expiresAt: Date.now() + 10 * 60 * 1000,
				});

				await sendOTPEmail(email, code);

				return res.status(200).json({
					message:
						"OTP sent to email. This email is registered but not as a cook.",
					isExistingUser: true,
					isCook: false,
				});
			}

			return res.status(409).json({
				message: "Account already exists as a cook. Please login instead.",
				isExistingUser: true,
				isCook: true,
			});
		}

		// New user
		const code = generateOTP();

		await OTP.create({
			email,
			code,
			expiresAt: Date.now() + 10 * 60 * 1000,
		});

		await sendOTPEmail(email, code);

		res.status(200).json({
			message: "OTP sent to email",
			isExistingUser: false,
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// STEP 2: Verify OTP
export const signupVerify = async (req, res) => {
	try {
		let { email, otp } = req.body;

		if (!email || !otp) {
			return res.status(400).json({
				message: "Email and OTP are required",
			});
		}

		email = email.toLowerCase().trim();

		const record = await OTP.findOne({ email, code: otp });

		if (!record) {
			return res.status(400).json({
				message: "Incorrect OTP",
			});
		}

		if (record.expiresAt < Date.now()) {
			return res.status(400).json({
				message: "OTP has expired",
			});
		}

		record.verified = true;
		await record.save();

		res.status(200).json({
			message: "OTP verified successfully",
			verified: true,
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// STEP 3: Complete Signup - Cook Onboarding
// controllers/authController.js - Updated signupComplete with image upload

export const signupComplete = async (req, res) => {
	try {
		const {
			email,
			storeName,
			storeHandle,
			phone,
			storeDescription,
			state,
			kitchenAddress,
			pickupLandmark,
			pickupWindow,
			deliveryEnabled,
			deliveryFee,
			preparationDays,
			termsAccepted,
		} = req.body;

		// Validate required fields
		if (!email || !storeName || !storeHandle || !phone || !termsAccepted) {
			return res.status(400).json({
				message:
					"Email, store name, store handle, phone, and terms acceptance are required",
			});
		}

		const normalizedEmail = email.toLowerCase().trim();
		const normalizedHandle = storeHandle.toLowerCase().trim();

		// Check if user already exists
		let user = await User.findOne({ email: normalizedEmail });

		if (user && user.isCook) {
			return res.status(409).json({
				message: "Account already exists as a cook. Please login.",
			});
		}

		// Check OTP verification
		const otpRecord = await OTP.findOne({
			email: normalizedEmail,
			verified: true,
		});

		if (!otpRecord) {
			return res.status(400).json({
				message: "Email not verified. Please verify your email with OTP first.",
			});
		}

		// Check if store handle is available
		const existingStore = await CookProfile.findOne({
			storeHandle: normalizedHandle,
		});

		if (existingStore) {
			return res.status(409).json({
				message: "Store handle is already taken. Please choose another one.",
				field: "storeHandle",
			});
		}

		// Validate phone number (Nigeria 11 digits)
		const phoneRegex = /^[0-9]{11}$/;
		if (!phoneRegex.test(phone.replace(/\D/g, ""))) {
			return res.status(400).json({
				message: "Please enter a valid 11-digit Nigerian phone number",
				field: "phone",
			});
		}

		// Validate pickup window
		if (!pickupWindow || !pickupWindow.from || !pickupWindow.to) {
			return res.status(400).json({
				message: "Pickup window (from and to) is required",
				field: "pickupWindow",
			});
		}

		// Validate preparation days
		if (!preparationDays || preparationDays < 1) {
			return res.status(400).json({
				message: "Preparation days must be at least 1 day",
				field: "preparationDays",
			});
		}

		// Handle image uploads
		let profileImageUrl = null;
		let coverImageUrl = null;

		// Upload profile image if provided
		if (req.files && req.files.profileImage) {
			try {
				const result = await cloudinary.v2.uploader.upload(
					req.files.profileImage[0].path,
					{
						folder: "getameal/cooks/profiles",
						transformation: [{ width: 500, height: 500, crop: "fill" }],
					},
				);
				profileImageUrl = result.secure_url;
				fs.unlinkSync(req.files.profileImage[0].path);
			} catch (uploadError) {
				console.error("Profile image upload error:", uploadError);
				// Continue without image
			}
		}

		// Upload cover image if provided
		if (req.files && req.files.coverImage) {
			try {
				const result = await cloudinary.v2.uploader.upload(
					req.files.coverImage[0].path,
					{
						folder: "getameal/cooks/covers",
						transformation: [{ width: 1200, height: 400, crop: "fill" }],
					},
				);
				coverImageUrl = result.secure_url;
				fs.unlinkSync(req.files.coverImage[0].path);
			} catch (uploadError) {
				console.error("Cover image upload error:", uploadError);
				// Continue without image
			}
		}

		// Create or update user
		if (!user) {
			user = await User.create({
				email: normalizedEmail,
				fullName: storeName,
				phone: phone,
				isVerified: true,
				provider: "email",
				status: "active",
				isCook: true,
				role: "cook",
				profileImage: profileImageUrl,
				coverImage: coverImageUrl,
			});
		} else {
			user.fullName = storeName;
			user.phone = phone;
			user.isCook = true;
			user.role = "cook";
			user.isVerified = true;
			if (profileImageUrl) user.profileImage = profileImageUrl;
			if (coverImageUrl) user.coverImage = coverImageUrl;
			await user.save();
		}

		// Create cook profile
		const cookProfile = await CookProfile.create({
			userId: user._id,
			storeName,
			storeHandle: normalizedHandle,
			storeDescription: storeDescription || "",
			phone,
			email: normalizedEmail,
			state,
			kitchenAddress,
			pickupLandmark,
			pickupWindow: {
				from: pickupWindow.from,
				to: pickupWindow.to,
			},
			deliveryEnabled: deliveryEnabled || false,
			deliveryFee: deliveryEnabled ? deliveryFee || 0 : 0,
			preparationDays: preparationDays || 1,
			profileImage: profileImageUrl,
			coverImage: coverImageUrl,
			termsAccepted: true,
			termsAcceptedAt: new Date(),
			isApproved: false,
			isAvailable: true,
			walletBalance: 0,
			storeLink: `https://getameal-client.vercel.app/${normalizedHandle}`,
		});

		// Clean up OTP
		await OTP.deleteOne({ _id: otpRecord._id });

		const token = generateToken(user._id);

		res.status(201).json({
			success: true,
			message: "Store created successfully! Awaiting admin approval.",
			token,
			user: {
				_id: user._id,
				email: user.email,
				fullName: user.fullName,
				phone: user.phone,
				role: user.role,
				isCook: user.isCook,
				status: user.status,
				isVerified: user.isVerified,
				profileImage: user.profileImage,
				coverImage: user.coverImage,
			},
			cookProfile: {
				id: cookProfile._id,
				storeName: cookProfile.storeName,
				storeHandle: cookProfile.storeHandle,
				storeLink: cookProfile.storeLink,
				isApproved: cookProfile.isApproved,
				isAvailable: cookProfile.isAvailable,
				pickupWindow: cookProfile.pickupWindow,
				deliveryEnabled: cookProfile.deliveryEnabled,
				deliveryFee: cookProfile.deliveryFee,
				preparationDays: cookProfile.preparationDays,
				profileImage: cookProfile.profileImage,
				coverImage: cookProfile.coverImage,
			},
		});
	} catch (error) {
		console.error("Signup complete error:", error);
		// Clean up any uploaded files if error occurs
		if (req.files) {
			if (req.files.profileImage) {
				fs.unlinkSync(req.files.profileImage[0].path);
			}
			if (req.files.coverImage) {
				fs.unlinkSync(req.files.coverImage[0].path);
			}
		}
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// ===== SOCIAL AUTH (Google & Apple) =====

export const socialAuth = async (req, res) => {
	try {
		const { idToken, name, email, appleUserId } = req.body;

		if (!idToken) {
			return res.status(400).json({
				success: false,
				message: "Token required",
			});
		}

		// Verify Firebase token
		const decoded = await verifyFirebaseToken(idToken);
		const { uid, email: fbEmail, firebase } = decoded;

		let userEmail = email || fbEmail;

		if (userEmail) {
			userEmail = userEmail.toLowerCase().trim();
		}

		const provider = firebase?.sign_in_provider || "google.com";

		if (!userEmail) {
			return res.status(400).json({
				success: false,
				message: "Email is required for authentication",
			});
		}

		// Try to find existing user
		let user = await User.findOne({ firebaseUid: uid });

		if (!user && appleUserId) {
			user = await User.findOne({ appleUserId });
		}

		if (!user && userEmail) {
			user = await User.findOne({ email: userEmail });
		}

		// --- IF USER EXISTS ---
		if (user) {
			// Check user account suspension
			if (user.status === "suspended") {
				return res.status(403).json({
					success: false,
					message: "Your account has been suspended. Please contact support.",
					error: "ACCOUNT_SUSPENDED",
				});
			}

			// Check if user is a cook
			if (!user.isCook) {
				// User exists but is not a cook - they need to complete cook onboarding
				return res.status(200).json({
					success: true,
					message: "User found. Please complete cook onboarding.",
					requiresOnboarding: true,
					user: {
						_id: user._id,
						email: user.email,
						fullName: user.fullName,
						isCook: user.isCook,
					},
					token: generateToken(user._id),
				});
			}

			// User is a cook - proceed with login
			// Update user info
			let needsUpdate = false;

			if (!user.firebaseUid && uid) {
				user.firebaseUid = uid;
				needsUpdate = true;
			}
			if (!user.fullName && name) {
				user.fullName = name;
				needsUpdate = true;
			}
			if (appleUserId && !user.appleUserId) {
				user.appleUserId = appleUserId;
				needsUpdate = true;
			}
			if (!user.provider) {
				user.provider = provider;
				needsUpdate = true;
			}

			user.lastLoginAt = new Date();
			needsUpdate = true;

			if (needsUpdate) {
				await user.save();
			}

			// Get cook profile
			const cookProfile = await CookProfile.findOne({ userId: user._id });

			if (!cookProfile) {
				return res.status(404).json({
					success: false,
					message: "Cook profile not found. Please complete your registration.",
				});
			}

			// Check if cook is suspended
			if (cookProfile.isSuspended) {
				return res.status(403).json({
					success: false,
					message:
						"Your cook account has been suspended. Please contact support.",
					error: "COOK_ACCOUNT_SUSPENDED",
				});
			}

			const token = generateToken(user._id);

			const userData = {
				_id: user._id,
				email: user.email,
				fullName: user.fullName,
				phone: user.phone,
				role: user.role,
				isCook: user.isCook,
				profileImage: user.profileImage,
				coverImage: user.coverImage,
				status: user.status,
				isVerified: user.isVerified,
				provider: user.provider,
			};

			// Cook profile data
			const cookProfileData = {
				id: cookProfile._id,
				storeName: cookProfile.storeName,
				storeHandle: cookProfile.storeHandle,
				storeLink: cookProfile.storeLink,
				storeDescription: cookProfile.storeDescription,
				phone: cookProfile.phone,
				email: cookProfile.email,
				state: cookProfile.state,
				kitchenAddress: cookProfile.kitchenAddress,
				pickupLandmark: cookProfile.pickupLandmark,
				pickupWindow: cookProfile.pickupWindow,
				deliveryEnabled: cookProfile.deliveryEnabled,
				deliveryFee: cookProfile.deliveryFee,
				preparationDays: cookProfile.preparationDays,
				profileImage: cookProfile.profileImage,
				coverImage: cookProfile.coverImage,
				isApproved: cookProfile.isApproved,
				isAvailable: cookProfile.isAvailable,
				isSuspended: cookProfile.isSuspended || false,
				rating: cookProfile.rating || 0,
				ordersCount: cookProfile.ordersCount || 0,
				walletBalance: cookProfile.walletBalance || 0,
				viewsThisWeek: cookProfile.viewsThisWeek || 0,
			};

			return res.status(200).json({
				success: true,
				message: "Login successful",
				token,
				user: userData,
				cookProfile: cookProfileData,
				accountStatus: {
					isSuspended: user.status === "suspended",
					status: user.status,
					isApproved: cookProfile.isApproved,
					requiresApproval: !cookProfile.isApproved,
					isCookSuspended: cookProfile.isSuspended || false,
				},
			});
		}

		// --- CREATE NEW USER ---
		user = await User.create({
			fullName: name || userEmail.split("@")[0],
			email: userEmail,
			firebaseUid: uid,
			appleUserId: appleUserId || undefined,
			provider,
			isVerified: true,
			status: "active",
			isCook: false, // Not a cook yet
			role: "user",
			lastLoginAt: new Date(),
		});

		const token = generateToken(user._id);

		// User created but needs to complete cook onboarding
		return res.status(200).json({
			success: true,
			message: "Account created. Please complete cook onboarding.",
			requiresOnboarding: true,
			token,
			user: {
				_id: user._id,
				email: user.email,
				fullName: user.fullName,
				isCook: user.isCook,
				role: user.role,
				status: user.status,
				isVerified: user.isVerified,
			},
		});
	} catch (error) {
		console.error("Social auth error:", error);

		// Handle duplicate key error
		if (error.code === 11000) {
			try {
				const existingUser = await User.findOne({
					email: req.body.email?.toLowerCase().trim(),
				});
				if (existingUser) {
					// If user exists but is not a cook
					if (!existingUser.isCook) {
						const token = generateToken(existingUser._id);
						return res.status(200).json({
							success: true,
							message: "User found. Please complete cook onboarding.",
							requiresOnboarding: true,
							token,
							user: {
								_id: existingUser._id,
								email: existingUser.email,
								fullName: existingUser.fullName,
								isCook: existingUser.isCook,
							},
						});
					}

					// User is a cook - login them in
					const token = generateToken(existingUser._id);
					const cookProfile = await CookProfile.findOne({
						userId: existingUser._id,
					});

					return res.status(200).json({
						success: true,
						message: "Login successful",
						token,
						user: existingUser,
						cookProfile: cookProfile,
					});
				}
			} catch (findError) {
				console.error("Error finding existing user:", findError);
			}
		}

		return res.status(500).json({
			success: false,
			message: "Authentication failed. Please try again.",
			error: error.message,
		});
	}
};

// ===== SOCIAL AUTH ONBOARDING COMPLETE =====

// Complete social auth onboarding (convert to cook)
export const socialAuthOnboardingComplete = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			storeName,
			storeHandle,
			phone,
			storeDescription,
			state,
			kitchenAddress,
			pickupLandmark,
			pickupWindow,
			deliveryEnabled,
			deliveryFee,
			preparationDays,
			profileImage,
			coverImage,
			termsAccepted,
		} = req.body;

		// Validate required fields
		if (!storeName || !storeHandle || !phone || !termsAccepted) {
			return res.status(400).json({
				message:
					"Store name, store handle, phone, and terms acceptance are required",
			});
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		// Check if user is already a cook
		if (user.isCook) {
			return res.status(400).json({
				message: "User is already a cook",
			});
		}

		const normalizedHandle = storeHandle.toLowerCase().trim();

		// Check if store handle is available
		const existingStore = await CookProfile.findOne({
			storeHandle: normalizedHandle,
		});

		if (existingStore) {
			return res.status(409).json({
				message: "Store handle is already taken. Please choose another one.",
				field: "storeHandle",
			});
		}

		// Validate phone number
		const phoneRegex = /^[0-9]{11}$/;
		if (!phoneRegex.test(phone.replace(/\D/g, ""))) {
			return res.status(400).json({
				message: "Please enter a valid 11-digit Nigerian phone number",
				field: "phone",
			});
		}

		// Validate pickup window
		if (!pickupWindow || !pickupWindow.from || !pickupWindow.to) {
			return res.status(400).json({
				message: "Pickup window (from and to) is required",
				field: "pickupWindow",
			});
		}

		// Validate preparation days
		if (!preparationDays || preparationDays < 1) {
			return res.status(400).json({
				message: "Preparation days must be at least 1 day",
				field: "preparationDays",
			});
		}

		// Update user
		user.fullName = storeName;
		user.phone = phone;
		user.isCook = true;
		user.role = "cook";
		await user.save();

		// Create cook profile
		const cookProfile = await CookProfile.create({
			userId: user._id,
			storeName,
			storeHandle: normalizedHandle,
			storeDescription: storeDescription || "",
			phone,
			email: user.email,
			state,
			kitchenAddress,
			pickupLandmark,
			pickupWindow: {
				from: pickupWindow.from,
				to: pickupWindow.to,
			},
			deliveryEnabled: deliveryEnabled || false,
			deliveryFee: deliveryEnabled ? deliveryFee || 0 : 0,
			preparationDays: preparationDays || 1,
			profileImage: profileImage || null,
			coverImage: coverImage || null,
			termsAccepted: true,
			termsAcceptedAt: new Date(),
			isApproved: false,
			isAvailable: true,
			walletBalance: 0,
			storeLink: `https://getameal-client.vercel.app/${normalizedHandle}`,
		});

		const token = generateToken(user._id);

		res.status(201).json({
			success: true,
			message: "Store created successfully! Awaiting admin approval.",
			token,
			user: {
				_id: user._id,
				email: user.email,
				fullName: user.fullName,
				phone: user.phone,
				role: user.role,
				isCook: user.isCook,
				status: user.status,
				isVerified: user.isVerified,
				profileImage: user.profileImage,
				coverImage: user.coverImage,
			},
			cookProfile: {
				id: cookProfile._id,
				storeName: cookProfile.storeName,
				storeHandle: cookProfile.storeHandle,
				storeLink: cookProfile.storeLink,
				isApproved: cookProfile.isApproved,
				isAvailable: cookProfile.isAvailable,
				pickupWindow: cookProfile.pickupWindow,
				deliveryEnabled: cookProfile.deliveryEnabled,
				deliveryFee: cookProfile.deliveryFee,
				preparationDays: cookProfile.preparationDays,
			},
		});
	} catch (error) {
		console.error("Social auth onboarding complete error:", error);
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// ===== LOGIN FLOW (Email/OTP) =====

// STEP 1: Login Init
export const loginInit = async (req, res) => {
	try {
		let { email } = req.body;

		if (!email) {
			return res.status(400).json({
				message: "Email is required",
			});
		}

		email = email.toLowerCase().trim();

		const user = await User.findOne({ email });

		if (!user) {
			return res.status(404).json({
				message: "Account not found. Please register first.",
			});
		}

		// Check if user is a cook
		if (!user.isCook) {
			return res.status(403).json({
				message:
					"This account is not registered as a cook. Please sign up as a cook.",
			});
		}

		// Check if user account is suspended
		if (user.status === "suspended") {
			const suspensionNote = user.notes?.find((n) =>
				n.note?.toLowerCase().includes("suspended"),
			);

			return res.status(403).json({
				message: "Your account has been suspended. Please contact support.",
				error: "ACCOUNT_SUSPENDED",
				details: {
					reason: suspensionNote?.note || "Violation of terms",
					supportEmail: process.env.SUPPORT_EMAIL || "support@getameal.com",
				},
			});
		}

		// Check if user account is inactive
		if (user.status === "inactive") {
			return res.status(403).json({
				message: "Your account is inactive. Please contact support.",
				error: "ACCOUNT_INACTIVE",
			});
		}

		// Get cook profile
		const cookProfile = await CookProfile.findOne({ userId: user._id });

		if (!cookProfile) {
			return res.status(404).json({
				message: "Cook profile not found. Please complete your registration.",
			});
		}

		const code = generateOTP();

		await OTP.create({
			email,
			code,
			expiresAt: Date.now() + 10 * 60 * 1000,
		});

		await sendOTPEmail(email, code);

		res.status(200).json({
			message: "OTP sent to your email",
			user: {
				email: user.email,
				fullName: user.fullName,
				isCook: user.isCook,
				role: user.role,
				status: user.status,
			},
			cookProfile: {
				storeName: cookProfile.storeName,
				storeHandle: cookProfile.storeHandle,
				isApproved: cookProfile.isApproved,
				isAvailable: cookProfile.isAvailable,
			},
		});
	} catch (error) {
		console.error("Login init error:", error);
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// STEP 2: Login Verify
export const loginVerify = async (req, res) => {
	try {
		let { email, otp } = req.body;

		if (!email || !otp) {
			return res.status(400).json({
				message: "Email and OTP are required",
			});
		}

		email = email.toLowerCase().trim();

		const record = await OTP.findOne({ email, code: otp });

		if (!record) {
			return res.status(400).json({ message: "Invalid OTP code" });
		}

		if (record.expiresAt < Date.now()) {
			await OTP.deleteOne({ _id: record._id });
			return res
				.status(400)
				.json({ message: "OTP has expired. Please request a new one." });
		}

		const user = await User.findOne({ email });

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		// Check if user is a cook
		if (!user.isCook) {
			return res.status(403).json({
				message: "This account is not registered as a cook.",
			});
		}

		// Check suspension
		if (user.status === "suspended") {
			const suspensionNote = user.notes?.find((n) =>
				n.note?.toLowerCase().includes("suspended"),
			);

			return res.status(403).json({
				message: "Your account has been suspended. Please contact support.",
				error: "ACCOUNT_SUSPENDED",
				details: {
					reason: suspensionNote?.note || "Violation of terms of service",
					suspendedAt: user.updatedAt,
					supportEmail: process.env.SUPPORT_EMAIL || "support@getameal.com",
				},
			});
		}

		if (user.status === "inactive") {
			return res.status(403).json({
				message: "Your account is inactive. Please contact support.",
				error: "ACCOUNT_INACTIVE",
			});
		}

		// Get cook profile
		const cookProfile = await CookProfile.findOne({ userId: user._id });

		if (!cookProfile) {
			return res.status(404).json({
				message: "Cook profile not found. Please complete your registration.",
			});
		}

		// Check if cook is suspended
		if (cookProfile.isSuspended) {
			return res.status(403).json({
				message:
					"Your cook account has been suspended. Please contact support.",
				error: "COOK_ACCOUNT_SUSPENDED",
				details: {
					reason: cookProfile.suspensionReason,
					supportEmail: process.env.SUPPORT_EMAIL || "support@getameal.com",
				},
			});
		}

		// Delete used OTP
		await OTP.deleteOne({ _id: record._id });

		// Update last login
		user.lastLoginAt = new Date();
		await user.save();

		// Generate token
		const token = generateToken(user._id);

		// Remove sensitive data
		const userData = {
			_id: user._id,
			email: user.email,
			fullName: user.fullName,
			phone: user.phone,
			role: user.role,
			isCook: user.isCook,
			profileImage: user.profileImage,
			coverImage: user.coverImage,
			location: user.location,
			status: user.status,
			isVerified: user.isVerified,
			createdAt: user.createdAt,
			updatedAt: user.updatedAt,
		};

		// Cook profile data
		const cookProfileData = {
			id: cookProfile._id,
			storeName: cookProfile.storeName,
			storeHandle: cookProfile.storeHandle,
			storeLink: cookProfile.storeLink,
			storeDescription: cookProfile.storeDescription,
			phone: cookProfile.phone,
			email: cookProfile.email,
			state: cookProfile.state,
			kitchenAddress: cookProfile.kitchenAddress,
			pickupLandmark: cookProfile.pickupLandmark,
			pickupWindow: cookProfile.pickupWindow,
			deliveryEnabled: cookProfile.deliveryEnabled,
			deliveryFee: cookProfile.deliveryFee,
			preparationDays: cookProfile.preparationDays,
			profileImage: cookProfile.profileImage,
			coverImage: cookProfile.coverImage,
			isApproved: cookProfile.isApproved,
			isAvailable: cookProfile.isAvailable,
			isSuspended: cookProfile.isSuspended || false,
			rating: cookProfile.rating || 0,
			ordersCount: cookProfile.ordersCount || 0,
			walletBalance: cookProfile.walletBalance || 0,
			viewsThisWeek: cookProfile.viewsThisWeek || 0,
			createdAt: cookProfile.createdAt,
			updatedAt: cookProfile.updatedAt,
		};

		res.status(200).json({
			success: true,
			message: "Login successful",
			token,
			user: userData,
			cookProfile: cookProfileData,
			accountStatus: {
				isSuspended: user.status === "suspended",
				status: user.status,
				isCookSuspended: cookProfile.isSuspended || false,
				isApproved: cookProfile.isApproved,
				requiresApproval: !cookProfile.isApproved,
			},
		});
	} catch (error) {
		console.error("Login verify error:", error);
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};

// ===== STORE HANDLE CHECK =====

export const checkStoreHandle = async (req, res) => {
	try {
		const { handle } = req.params;

		if (!handle) {
			return res.status(400).json({
				message: "Store handle is required",
			});
		}

		const normalizedHandle = handle.toLowerCase().trim();

		// Check if handle is valid (alphanumeric, hyphens allowed)
		const handleRegex = /^[a-zA-Z0-9-]+$/;
		if (!handleRegex.test(normalizedHandle)) {
			return res.status(400).json({
				message: "Store handle can only contain letters, numbers, and hyphens",
				available: false,
				suggestion: "Use only letters, numbers, and hyphens",
			});
		}

		// Check if handle is already taken
		const existingStore = await CookProfile.findOne({
			storeHandle: normalizedHandle,
		});

		// Check if handle is reserved
		const reservedHandles = [
			"admin",
			"support",
			"help",
			"api",
			"www",
			"cook",
			"store",
			"home",
			"dashboard",
			"settings",
		];
		const isReserved = reservedHandles.includes(normalizedHandle);

		if (existingStore) {
			return res.status(200).json({
				available: false,
				message: "This store handle is already taken",
				suggestion: `Try ${normalizedHandle}${Math.floor(Math.random() * 100)}`,
			});
		}

		if (isReserved) {
			return res.status(200).json({
				available: false,
				message: "This store handle is reserved",
				suggestion: `Try ${normalizedHandle}-cook${Math.floor(Math.random() * 100)}`,
			});
		}

		res.status(200).json({
			available: true,
			message: "Store handle is available!",
			storeLink: `https://getameal-client.vercel.app/${normalizedHandle}`,
		});
	} catch (error) {
		res.status(500).json({
			message: "Server error",
			error: error.message,
		});
	}
};
