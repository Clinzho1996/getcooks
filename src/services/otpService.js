import OTP from "../models/OTP.js";

export const generateOTP = async (email) => {
	const code = Math.floor(100000 + Math.random() * 900000).toString();

	await OTP.create({
		email,
		code,
		expiresAt: Date.now() + 10 * 60 * 1000,
	});

	return code;
};

export const signupInit = async (req, res) => {
	const { email } = req.body;
	const otp = await generateOTP(email);

	await sendEmail(email, otp);

	res.json({ message: "OTP sent" });
};

export const signupVerify = async (req, res) => {
	const { email, otp } = req.body;

	const record = await OTP.findOne({ email, code: otp });

	if (!record || record.expiresAt < Date.now()) {
		return res.status(400).json({ error: "Invalid OTP" });
	}

	res.json({ verified: true });
};

export const completeSignup = async (req, res) => {
	const user = await User.create(req.body);
	const token = generateJWT(user._id);

	res.json({ token, user });
};
