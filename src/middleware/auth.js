// middleware/auth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

const protect = async (req, res, next) => {
	try {
		const authHeader = req.headers.authorization;

		if (!authHeader || !authHeader.startsWith("Bearer ")) {
			return res.status(401).json({ message: "Not authorized, token missing" });
		}

		const token = authHeader.split(" ")[1];

		let decoded;
		try {
			decoded = jwt.verify(token, process.env.JWT_SECRET);
		} catch (err) {
			return res.status(401).json({ message: "Token invalid or expired" });
		}

		const user = await User.findById(decoded.id);

		if (!user) {
			return res.status(404).json({ message: "User not found" });
		}

		req.user = user; // attach user to request for controllers
		next();
	} catch (error) {
		console.error(error);
		res.status(500).json({ message: "Server error" });
	}
};

export default protect;
