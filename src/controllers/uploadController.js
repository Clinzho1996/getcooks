import cloudinary from "../config/cloudinary.js";

export const getSignature = (req, res) => {
	const timestamp = Math.round(new Date().getTime() / 1000);

	const signature = cloudinary.utils.api_sign_request(
		{ timestamp },
		process.env.CLOUD_SECRET,
	);

	res.json({
		timestamp,
		signature,
		cloudName: process.env.CLOUD_NAME,
		apiKey: process.env.CLOUD_KEY,
	});
};
