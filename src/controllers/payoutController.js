import { paystack } from "../config/paystack.js";
import CookProfile from "../models/CookProfile.js";
import PendingTransfer from "../models/PendingTransfer.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { createAdminNotification } from "../utils/adminNotification.js";

/**
 * Request payout
 */
// controllers/payoutController.js - Fixed requestPayout

import axios from "axios";
import User from "../models/User.js";
import { sendPushToUser } from "../services/pushService.js";

/**
 * Request payout
 */
export const requestPayout = async (req, res) => {
	try {
		const { amount } = req.body;
		const userId = req.user._id;

		if (!amount || amount <= 0) {
			return res.status(400).json({ message: "Invalid payout amount" });
		}

		// Find cook profile
		const cookProfile = await CookProfile.findOne({ userId });
		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		if (!cookProfile.bankDetails || !cookProfile.bankDetails.accountNumber) {
			return res.status(400).json({
				message: "Bank details not set. Please add your bank account first.",
			});
		}

		console.log(
			"Wallet balance:",
			cookProfile.walletBalance,
			"Requested payout:",
			amount,
		);

		if (cookProfile.walletBalance < amount) {
			return res.status(400).json({
				message: `Insufficient balance. Your wallet has ₦${cookProfile.walletBalance}`,
			});
		}

		let recipientCode = cookProfile.bankDetails.recipientCode;

		// Create recipient if missing
		if (!recipientCode) {
			try {
				// ✅ Use axios directly with proper Paystack API format
				const recipientResponse = await axios.post(
					"https://api.paystack.co/transferrecipient",
					{
						type: "nuban",
						name:
							cookProfile.cookDisplayName ||
							cookProfile.storeName ||
							req.user.fullName,
						account_number: cookProfile.bankDetails.accountNumber,
						bank_code: cookProfile.bankDetails.bankCode,
						currency: "NGN",
					},
					{
						headers: {
							Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
							"Content-Type": "application/json",
						},
					},
				);

				console.log("Recipient creation response:", recipientResponse.data);

				if (
					!recipientResponse.data.status ||
					!recipientResponse.data.data?.recipient_code
				) {
					console.error(
						"Paystack recipient creation failed",
						recipientResponse.data,
					);
					return res.status(500).json({
						message: "Failed to create transfer recipient",
						error: recipientResponse.data.message,
					});
				}

				recipientCode = recipientResponse.data.data.recipient_code;
				cookProfile.bankDetails.recipientCode = recipientCode;
				await cookProfile.save();

				console.log(`✅ Recipient created: ${recipientCode}`);
			} catch (recipientError) {
				console.error(
					"Recipient creation error:",
					recipientError.response?.data || recipientError.message,
				);
				return res.status(500).json({
					message: "Failed to create transfer recipient",
					error: recipientError.response?.data || recipientError.message,
				});
			}
		}

		// Initiate transfer
		try {
			const transferResponse = await axios.post(
				"https://api.paystack.co/transfer",
				{
					source: "balance",
					amount: amount * 100, // Convert naira to kobo
					recipient: recipientCode,
					reason: `Payout for ${cookProfile.storeName}`,
				},
				{
					headers: {
						Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
						"Content-Type": "application/json",
					},
				},
			);

			console.log("Transfer response:", transferResponse.data);

			if (!transferResponse.data.status) {
				console.error("Transfer initiation failed:", transferResponse.data);
				return res.status(400).json({
					message: "Transfer initiation failed",
					error: transferResponse.data.message,
				});
			}

			const transferData = transferResponse.data.data;

			// Deduct from wallet
			cookProfile.walletBalance -= amount;
			await cookProfile.save();

			// Also deduct from User wallet
			const user = await User.findById(userId);
			if (user) {
				user.walletBalance = (user.walletBalance || 0) - amount;
				await user.save();
			}

			// Record pending transfer
			await PendingTransfer.create({
				cookId: userId,
				amount,
				transferCode: transferData.transfer_code,
				status: transferData.status === "otp" ? "pending_otp" : "pending",
			});

			// Create transaction record
			await WalletTransaction.create({
				cookId: userId,
				type: "payout",
				amount: amount,
				reference: transferData.transfer_code,
				description: `Payout of ₦${amount} to bank account`,
				status: "pending",
			});

			console.log("✅ Paystack transfer initiated", transferData);

			// Send notifications
			await createAdminNotification({
				title: "Payout Requested",
				body: `A new payout request of ₦${amount} has been submitted by ${req.user.fullName}`,
				type: "cook",
				data: { cookId: userId, amount },
			});

			await sendPushToUser(
				userId,
				"💰 Payout Requested",
				`Your payout request for ₦${amount} has been received.`,
				{ amount },
			);

			return res.status(200).json({
				success: true,
				message: "Payout request initiated successfully",
				data: {
					amount,
					transferCode: transferData.transfer_code,
					status: transferData.status,
					requiresOTP: transferData.status === "otp",
				},
			});
		} catch (transferError) {
			console.error(
				"Transfer error:",
				transferError.response?.data || transferError.message,
			);

			// Don't deduct wallet if transfer failed
			return res.status(500).json({
				message: "Transfer initiation failed",
				error: transferError.response?.data || transferError.message,
			});
		}
	} catch (err) {
		console.error(
			"Payout initiation error:",
			err.response?.data || err.message,
		);
		return res.status(500).json({
			message: "Payout initiation failed",
			error: err.response?.data || err.message,
		});
	}
};

/**
 * Verify payout with OTP
 */
export const verifyPayoutOTP = async (req, res) => {
	const { transferCode, otp } = req.body;

	if (!transferCode || !otp) {
		return res
			.status(400)
			.json({ message: "transferCode and OTP are required" });
	}

	try {
		const pendingTransfer = await PendingTransfer.findOne({
			transferCode,
			status: "pending_otp",
		});

		if (!pendingTransfer) {
			return res.status(404).json({
				message: "Pending transfer not found or already completed",
			});
		}

		const amount = pendingTransfer.amount;

		// Check transfer status from Paystack
		const statusResponse = await paystack.get(`/transfer/${transferCode}`);
		const transferData = statusResponse.data.data;

		if (!transferData) {
			return res
				.status(404)
				.json({ message: "Transfer not found on Paystack" });
		}

		const currentStatus = transferData.status;

		const cookProfile = await CookProfile.findOne({
			"bankDetails.recipientCode": transferData.recipient_code || undefined,
		});

		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		// If transfer already succeeded
		if (currentStatus === "success") {
			const existingTransaction = await WalletTransaction.findOne({
				cookId: cookProfile.userId,
				type: "payout",
				amount,
			});

			if (!existingTransaction) {
				cookProfile.walletBalance -= amount;
				await cookProfile.save();

				await WalletTransaction.create({
					cookId: cookProfile.userId,
					type: "payout",
					amount,
				});
			}

			pendingTransfer.status = "completed";
			await pendingTransfer.save();

			return res.json({ message: "Payout already processed successfully" });
		}

		// Finalize OTP
		if (currentStatus === "otp") {
			const verification = await paystack.post("/transfer/finalize_transfer", {
				transfer_code: transferCode,
				otp,
			});

			const verifiedData = verification.data.data || verification.data;

			if (verifiedData.status !== "success") {
				return res.status(400).json({
					message: "OTP verification failed",
					details: verifiedData,
				});
			}

			cookProfile.walletBalance -= amount;
			await cookProfile.save();

			await WalletTransaction.create({
				cookId: cookProfile.userId,
				type: "payout",
				amount,
			});

			pendingTransfer.status = "completed";
			await pendingTransfer.save();

			return res.json({
				message: "Payout verified and completed successfully",
			});
		}

		return res.status(400).json({
			message: `Cannot process transfer in status: ${currentStatus}`,
			details: transferData,
		});
	} catch (err) {
		console.error("OTP verification error:", err.response?.data || err.message);
		return res.status(500).json({
			message: "OTP verification failed",
			error: err.response?.data || err.message,
		});
	}
};

/**
 * Get payout history for a cook
 */
export const getPayoutHistory = async (req, res) => {
	try {
		const userId = req.user._id;

		// Find cook profile
		const cookProfile = await CookProfile.findOne({ userId });
		if (!cookProfile) {
			return res
				.status(403)
				.json({ message: "You are not registered as a cook" });
		}

		// Completed payouts
		const completed = await WalletTransaction.find({
			cookId: userId,
			type: "payout",
		})
			.sort({ createdAt: -1 })
			.lean();

		// Pending payouts
		const pending = await PendingTransfer.find({
			cookId: userId,
		})
			.sort({ createdAt: -1 })
			.lean();

		const formattedCompleted = completed.map((tx) => ({
			id: tx._id,
			amount: tx.amount,
			status: "completed",
			type: "payout",
			createdAt: tx.createdAt,
		}));

		const formattedPending = pending.map((p) => ({
			id: p._id,
			amount: p.amount,
			status: p.status,
			transferCode: p.transferCode,
			type: "payout",
			createdAt: p.createdAt,
		}));

		const history = [...formattedPending, ...formattedCompleted].sort(
			(a, b) => new Date(b.createdAt) - new Date(a.createdAt),
		);

		return res.json(history);
	} catch (error) {
		return res.status(500).json({
			message: "Failed to fetch payout history",
			error: error.message,
		});
	}
};
