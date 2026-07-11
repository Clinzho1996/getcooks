import axios from "axios";
import CookProfile from "../models/CookProfile.js";
import { sendPushToUser } from "../services/pushService.js";
import { createAdminNotification } from "../utils/adminNotification.js";

export const getBanks = async (req, res) => {
	try {
		const response = await axios.get("https://api.paystack.co/bank", {
			headers: {
				Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
			},
		});

		res.json(response.data.data);
	} catch (error) {
		res.status(500).json({
			message: "Failed to fetch banks",
		});
	}
};

export const getCookBankDetails = async (req, res) => {
	try {
		const userId = req.user.id;

		const cook = await CookProfile.findOne({ userId });

		if (!cook) {
			return res.status(404).json({
				message: "Cook profile not found",
			});
		}

		if (!cook.bankDetails || !cook.bankDetails.accountNumber) {
			return res.status(404).json({
				message: "No bank account found",
				bankDetails: null,
			});
		}

		// Return masked account number for security
		const bankDetails = {
			bankName: cook.bankDetails.bankName,
			bankCode: cook.bankDetails.bankCode,
			accountNumber: cook.bankDetails.accountNumber
				? `****${cook.bankDetails.accountNumber.slice(-4)}`
				: null,
			fullAccountNumber: cook.bankDetails.accountNumber, // Only include if needed
			accountName: cook.bankDetails.accountName,
			recipientCode: cook.bankDetails.recipientCode,
			hasAccount: true,
		};

		res.json({
			success: true,
			bankDetails: bankDetails,
		});
	} catch (error) {
		console.error("Error fetching bank details:", error);
		res.status(500).json({
			message: "Failed to fetch bank details",
			error: error.message,
		});
	}
};

export const verifyAccount = async (req, res) => {
	const { accountNumber, bankCode } = req.body;

	try {
		const response = await axios.get(
			`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		res.json(response.data.data);
	} catch (error) {
		res.status(400).json({
			message: "Invalid account",
		});
	}
};

export const addCookBankAccount = async (req, res) => {
	try {
		const { accountNumber, bankCode, bankName } = req.body;
		const userId = req.user.id;

		if (!accountNumber || !bankCode) {
			return res.status(400).json({
				message: "Account number and bank code are required",
			});
		}

		const cook = await CookProfile.findOne({ userId });

		if (!cook) {
			return res.status(404).json({
				message: "Cook profile not found",
			});
		}

		if (cook.bankDetails?.accountNumber) {
			return res.status(400).json({
				message: "Bank account already exists. Use update instead.",
			});
		}

		// Verify bank account with Paystack
		const response = await axios.get(
			`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		const { account_name } = response.data.data;

		cook.bankDetails = {
			accountNumber,
			bankCode,
			bankName,
			accountName: account_name,
		};

		await cook.save();

		// Fetch the updated cook profile to return complete data
		const updatedCook = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage",
		);

		// Prepare response with masked account number
		const bankDetails = {
			bankName: cook.bankDetails.bankName,
			bankCode: cook.bankDetails.bankCode,
			accountNumber: `****${cook.bankDetails.accountNumber.slice(-4)}`,
			accountName: cook.bankDetails.accountName,
			hasAccount: true,
		};

		res.status(201).json({
			success: true,
			message: "Bank account added successfully",
			bankDetails: bankDetails,
			cookProfile: {
				id: updatedCook._id,
				cookDisplayName: updatedCook.cookDisplayName,
				firstName: updatedCook.firstName,
				lastName: updatedCook.lastName,
				email: updatedCook.email,
				phone: updatedCook.phone,
				profilePhoto: updatedCook.profilePhoto,
				coverPhoto: updatedCook.coverPhoto,
				isApproved: updatedCook.isApproved,
				isAvailable: updatedCook.isAvailable,
				rating: updatedCook.rating,
				ordersCount: updatedCook.ordersCount,
				walletBalance: updatedCook.walletBalance,
				bankDetails: bankDetails,
				kycInfo: updatedCook.kycInfo,
				businessDetails: updatedCook.businessDetails,
			},
		});

		await createAdminNotification({
			title: "Bank Account Added",
			body: `A new bank account was added for ${req.user.fullName}`,
			type: "cook",
			data: { cookId: cook._id },
		});

		await sendPushToUser(
			userId,
			"Bank Account Added",
			`Your bank account ending with ${accountNumber.slice(-4)} has been added successfully.`,
			{ accountNumber: `****${accountNumber.slice(-4)}` },
		);
	} catch (error) {
		console.error("Error adding bank account:", error);
		res.status(500).json({
			message: "Failed to add bank account",
			error: error.message,
		});
	}
};

export const updateCookBankAccount = async (req, res) => {
	try {
		const { accountNumber, bankCode, bankName } = req.body;
		const userId = req.user.id;

		const cook = await CookProfile.findOne({ userId });

		if (!cook) {
			return res.status(404).json({
				message: "Cook profile not found",
			});
		}

		// Verify bank account with Paystack
		const response = await axios.get(
			`https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		const { account_name } = response.data.data;

		cook.bankDetails = {
			accountNumber,
			bankCode,
			bankName,
			accountName: account_name,
		};

		await cook.save();

		// Fetch the updated cook profile
		const updatedCook = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage",
		);

		// Prepare response with masked account number
		const bankDetails = {
			bankName: cook.bankDetails.bankName,
			bankCode: cook.bankDetails.bankCode,
			accountNumber: `****${cook.bankDetails.accountNumber.slice(-4)}`,
			accountName: cook.bankDetails.accountName,
			hasAccount: true,
		};

		res.json({
			success: true,
			message: "Bank account updated successfully",
			bankDetails: bankDetails,
			cookProfile: {
				id: updatedCook._id,
				cookDisplayName: updatedCook.cookDisplayName,
				firstName: updatedCook.firstName,
				lastName: updatedCook.lastName,
				email: updatedCook.email,
				phone: updatedCook.phone,
				profilePhoto: updatedCook.profilePhoto,
				coverPhoto: updatedCook.coverPhoto,
				isApproved: updatedCook.isApproved,
				isAvailable: updatedCook.isAvailable,
				rating: updatedCook.rating,
				ordersCount: updatedCook.ordersCount,
				walletBalance: updatedCook.walletBalance,
				bankDetails: bankDetails,
				kycInfo: updatedCook.kycInfo,
				businessDetails: updatedCook.businessDetails,
			},
		});

		await createAdminNotification({
			title: "Bank Account Updated",
			body: `The bank account for ${req.user.fullName} was updated`,
			type: "cook",
			data: { cookId: cook._id },
		});

		await sendPushToUser(
			userId,
			"Bank Account Updated",
			`Your bank account ending with ${accountNumber.slice(-4)} has been updated successfully.`,
			{ accountNumber: `****${accountNumber.slice(-4)}` },
		);
	} catch (error) {
		console.error("Error updating bank account:", error);
		res.status(500).json({
			message: "Failed to update bank account",
			error: error.message,
		});
	}
};

export const deleteCookBankAccount = async (req, res) => {
	try {
		const userId = req.user.id;

		const cook = await CookProfile.findOne({ userId });

		if (!cook) {
			return res.status(404).json({
				message: "Cook profile not found",
			});
		}

		cook.bankDetails = undefined;
		await cook.save();

		// Fetch the updated cook profile
		const updatedCook = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage",
		);

		res.json({
			success: true,
			message: "Bank account removed successfully",
			bankDetails: null,
			cookProfile: {
				id: updatedCook._id,
				cookDisplayName: updatedCook.cookDisplayName,
				firstName: updatedCook.firstName,
				lastName: updatedCook.lastName,
				email: updatedCook.email,
				phone: updatedCook.phone,
				profilePhoto: updatedCook.profilePhoto,
				coverPhoto: updatedCook.coverPhoto,
				isApproved: updatedCook.isApproved,
				isAvailable: updatedCook.isAvailable,
				rating: updatedCook.rating,
				ordersCount: updatedCook.ordersCount,
				walletBalance: updatedCook.walletBalance,
				bankDetails: null,
				kycInfo: updatedCook.kycInfo,
				businessDetails: updatedCook.businessDetails,
			},
		});

		await createAdminNotification({
			title: "Bank Account Removed",
			body: `The bank account for ${req.user.fullName} was removed`,
			type: "cook",
			data: { cookId: cook._id },
		});

		await sendPushToUser(
			userId,
			"Bank Account Removed",
			`Your bank account has been removed successfully.`,
			{},
		);
	} catch (error) {
		console.error("Error deleting bank account:", error);
		res.status(500).json({
			message: "Failed to delete bank account",
			error: error.message,
		});
	}
};
