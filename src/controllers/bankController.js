// controllers/bankController.js - Updated with subaccount creation

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

		const bankDetails = {
			bankName: cook.bankDetails.bankName,
			bankCode: cook.bankDetails.bankCode,
			accountNumber: cook.bankDetails.accountNumber
				? `****${cook.bankDetails.accountNumber.slice(-4)}`
				: null,
			fullAccountNumber: cook.bankDetails.accountNumber,
			accountName: cook.bankDetails.accountName,
			recipientCode: cook.bankDetails.recipientCode,
			subaccountCode: cook.bankDetails.subaccountCode,
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

		// ✅ Create Paystack subaccount for split payments
		let subaccountCode = null;
		let recipientCode = null;

		try {
			// 1. Create subaccount first
			const subaccountResponse = await axios.post(
				"https://api.paystack.co/subaccount",
				{
					business_name: cook.storeName || `${account_name}'s Kitchen`,
					settlement_bank: bankCode,
					account_number: accountNumber,
					percentage_charge: 5, // 5% platform fee charged to customer
					primary_contact_email: cook.email || req.user.email,
					primary_contact_name: account_name || req.user.fullName,
					settlement_schedule: "auto",
				},
				{
					headers: {
						Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
						"Content-Type": "application/json",
					},
				},
			);

			if (!subaccountResponse.data.status) {
				console.error("Subaccount creation failed:", subaccountResponse.data);
				return res.status(400).json({
					message: "Failed to create subaccount",
					error: subaccountResponse.data.message,
				});
			}

			subaccountCode = subaccountResponse.data.data.subaccount_code;

			// 2. Create transfer recipient for payouts
			const recipientResponse = await axios.post(
				"https://api.paystack.co/transferrecipient",
				{
					type: "nuban",
					name: account_name || req.user.fullName,
					account_number: accountNumber,
					bank_code: bankCode,
					currency: "NGN",
				},
				{
					headers: {
						Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
						"Content-Type": "application/json",
					},
				},
			);

			if (!recipientResponse.data.status) {
				console.error("Recipient creation failed:", recipientResponse.data);
				// Don't fail if recipient fails, subaccount is more important
			} else {
				recipientCode = recipientResponse.data.data.recipient_code;
			}

			console.log(`✅ Subaccount created: ${subaccountCode}`);
			console.log(`✅ Recipient created: ${recipientCode}`);
		} catch (paystackError) {
			console.error(
				"Paystack subaccount error:",
				paystackError.response?.data || paystackError.message,
			);

			// If subaccount creation fails, return error
			if (paystackError.response?.data?.message?.includes("duplicate")) {
				return res.status(400).json({
					message: "This bank account is already registered with Paystack",
					error: "Duplicate account",
				});
			}

			return res.status(400).json({
				message: "Failed to create Paystack subaccount",
				error: paystackError.response?.data?.message || paystackError.message,
			});
		}

		// Save bank details with subaccount code
		cook.bankDetails = {
			accountNumber,
			bankCode,
			bankName: bankName || response.data.data.bank_name,
			accountName: account_name,
			recipientCode: recipientCode,
			subaccountCode: subaccountCode,
		};

		await cook.save();

		// Fetch the updated cook profile
		const updatedCook = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage",
		);

		const bankDetails = {
			bankName: cook.bankDetails.bankName,
			bankCode: cook.bankDetails.bankCode,
			accountNumber: `****${cook.bankDetails.accountNumber.slice(-4)}`,
			accountName: cook.bankDetails.accountName,
			hasAccount: true,
			subaccountCode: cook.bankDetails.subaccountCode,
		};

		res.status(201).json({
			success: true,
			message:
				"Bank account added successfully with split payment configuration",
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
			title: "Bank Account Added with Subaccount",
			body: `A new bank account was added for ${req.user.fullName} with split payment configuration`,
			type: "cook",
			data: {
				cookId: cook._id,
				subaccountCode: subaccountCode,
				bankName: bankName,
				accountNumber: `****${accountNumber.slice(-4)}`,
			},
		});

		await sendPushToUser(
			userId,
			"Bank Account Added",
			`Your bank account ending with ${accountNumber.slice(-4)} has been added successfully with split payment configuration.`,
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

		// ✅ Update subaccount if it exists, or create new one
		let subaccountCode = cook.bankDetails?.subaccountCode;

		if (subaccountCode) {
			// Update existing subaccount
			try {
				await axios.put(
					`https://api.paystack.co/subaccount/${subaccountCode}`,
					{
						business_name: cook.storeName || `${account_name}'s Kitchen`,
						settlement_bank: bankCode,
						account_number: accountNumber,
						percentage_charge: 5,
						primary_contact_email: cook.email || req.user.email,
						primary_contact_name: account_name || req.user.fullName,
					},
					{
						headers: {
							Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
							"Content-Type": "application/json",
						},
					},
				);
				console.log(`✅ Subaccount updated: ${subaccountCode}`);
			} catch (updateError) {
				console.error(
					"Subaccount update failed:",
					updateError.response?.data || updateError.message,
				);
				// If update fails, create new subaccount
				subaccountCode = null;
			}
		}

		// Create new subaccount if needed
		if (!subaccountCode) {
			try {
				const subaccountResponse = await axios.post(
					"https://api.paystack.co/subaccount",
					{
						business_name: cook.storeName || `${account_name}'s Kitchen`,
						settlement_bank: bankCode,
						account_number: accountNumber,
						percentage_charge: 5,
						primary_contact_email: cook.email || req.user.email,
						primary_contact_name: account_name || req.user.fullName,
						settlement_schedule: "auto",
					},
					{
						headers: {
							Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
							"Content-Type": "application/json",
						},
					},
				);

				if (subaccountResponse.data.status) {
					subaccountCode = subaccountResponse.data.data.subaccount_code;
					console.log(`✅ New subaccount created: ${subaccountCode}`);
				}
			} catch (createError) {
				console.error(
					"Subaccount creation failed:",
					createError.response?.data || createError.message,
				);
			}
		}

		// Update recipient
		let recipientCode = cook.bankDetails?.recipientCode;
		try {
			// Delete old recipient if exists
			// Note: Paystack doesn't allow updating recipients, so we create a new one
			const recipientResponse = await axios.post(
				"https://api.paystack.co/transferrecipient",
				{
					type: "nuban",
					name: account_name || req.user.fullName,
					account_number: accountNumber,
					bank_code: bankCode,
					currency: "NGN",
				},
				{
					headers: {
						Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
						"Content-Type": "application/json",
					},
				},
			);

			if (recipientResponse.data.status) {
				recipientCode = recipientResponse.data.data.recipient_code;
				console.log(`✅ New recipient created: ${recipientCode}`);
			}
		} catch (recipientError) {
			console.error(
				"Recipient creation failed:",
				recipientError.response?.data || recipientError.message,
			);
		}

		cook.bankDetails = {
			accountNumber,
			bankCode,
			bankName: bankName || response.data.data.bank_name,
			accountName: account_name,
			recipientCode: recipientCode,
			subaccountCode: subaccountCode,
		};

		await cook.save();

		const updatedCook = await CookProfile.findOne({ userId }).populate(
			"userId",
			"fullName email phone profileImage",
		);

		const bankDetails = {
			bankName: cook.bankDetails.bankName,
			bankCode: cook.bankDetails.bankCode,
			accountNumber: `****${cook.bankDetails.accountNumber.slice(-4)}`,
			accountName: cook.bankDetails.accountName,
			hasAccount: true,
			subaccountCode: cook.bankDetails.subaccountCode,
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

		// Note: Paystack doesn't allow deleting subaccounts, only deactivating
		// We'll just remove the reference from our database

		cook.bankDetails = undefined;
		await cook.save();

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
