import { paystack } from "../config/paystack.js";
import CookProfile from "../models/CookProfile.js";
import PendingTransfer from "../models/PendingTransfer.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { createAdminNotification } from "../utils/adminNotification.js";

/**
 * Request payout
 */
export const requestPayout = async (req, res) => {
	try {
		const { amount } = req.body; // amount should be in naira
		const userId = req.user._id;

		if (!amount || amount <= 0) {
			return res.status(400).json({ message: "Invalid payout amount" });
		}

		// Find cook profile
		const cookProfile = await CookProfile.findOne({ userId });
		if (!cookProfile) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		if (!cookProfile.bankDetails) {
			return res.status(400).json({ message: "Bank details not set" });
		}

		console.log(
			"Wallet balance:",
			cookProfile.walletBalance,
			"Requested payout:",
			amount,
		);

		if (cookProfile.walletBalance < amount) {
			return res.status(400).json({
				message: `Insufficient balance. Your wallet has ${cookProfile.walletBalance}`,
			});
		}

		let recipientCode = cookProfile.bankDetails.recipientCode;

		// Create recipient if missing
		if (!recipientCode) {
			const recipient = await paystack.post("/transferrecipient", {
				type: "nuban",
				name: req.user.fullName,
				account_number: cookProfile.bankDetails.accountNumber,
				bank_code: cookProfile.bankDetails.bankCode,
				currency: "NGN",
			});

			if (!recipient.data.data.recipient_code) {
				console.error("Paystack recipient creation failed", recipient.data);
				return res
					.status(500)
					.json({ message: "Failed to create transfer recipient" });
			}

			cookProfile.bankDetails.recipientCode =
				recipient.data.data.recipient_code;
			await cookProfile.save();
			recipientCode = recipient.data.data.recipient_code;
		}

		// Initiate transfer (amount in kobo)
		const transfer = await paystack.post("/transfer", {
			source: "balance",
			amount: amount * 100, // Convert naira → kobo
			recipient: recipientCode,
		});

		const transferData = transfer.data.data;

		// Record pending transfer internally
		await PendingTransfer.create({
			cookId: userId,
			amount,
			transferCode: transferData.transfer_code,
			status: transferData.status === "otp" ? "pending_otp" : "pending",
		});

		console.log("Paystack transfer initiated", transferData);

		return res.status(200).json({
			message: "Payout request received and is being processed",
			amount,
		});

		await createAdminNotification({
			title: "Payout Requested",
			body: `A new payout request has been submitted for ${req.user.fullName}`,
			type: "cook",
			data: { cookId: userId },
		});

		await sendPushToUser(
			userId,
			"Payout Requested",
			`Your payout request for ${amount} NGN has been received and is being processed.`,
			{ amount },
		);
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
