import crypto from "crypto";

export const verifyPaystackSignature = (req) => {
	const hash = crypto
		.createHmac("sha512", process.env.PAYSTACK_SECRET)
		.update(JSON.stringify(req.body))
		.digest("hex");

	return hash === req.headers["x-paystack-signature"];
};
