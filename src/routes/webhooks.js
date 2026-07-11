import express from "express";
import {
	handleRefund,
	handleSuccessfulPayment,
} from "../controllers/paymentController.js";
import { verifyPaystackSignature } from "../middleware/verifyPaystackSignature.js";

const router = express.Router();

router.post("/paystack", verifyPaystackSignature, async (req, res) => {
	const event = req.body;

	try {
		if (event.event === "charge.success") {
			await handleSuccessfulPayment(event.data);
		}

		if (event.event === "refund.processed") {
			await handleRefund(event.data);
		}

		res.sendStatus(200);
	} catch (error) {
		console.error("Webhook error:", error.message);
		res.status(500).json({ message: error.message });
	}
});

export default router;
