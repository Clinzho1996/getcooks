// middleware/verifyPaystackSignature.js
import crypto from "crypto";

export const verifyPaystackSignature = (req, res, next) => {
	const paystackSecret = process.env.PAYSTACK_SECRET;

	const hash = crypto
		.createHmac("sha512", paystackSecret)
		.update(JSON.stringify(req.body))
		.digest("hex");

	const signature = req.headers["x-paystack-signature"];

	if (hash !== signature) {
		return res.status(401).json({ message: "Invalid signature" });
	}

	next();
};
