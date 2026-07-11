import bcrypt from "bcrypt";
import mongoose from "mongoose";
import User from "./models/User.js";

const createAdmin = async () => {
	await mongoose.connect(process.env.MONGO_URI);

	const existing = await User.findOne({ email: "admin@yourapp.com" });

	if (existing) {
		console.log("Admin already exists");
		process.exit();
	}

	const hashedPassword = await bcrypt.hash("Admin@1234", 10);

	await User.create({
		fullName: "Super Admin",
		email: "admin@getameal.app",
		password: hashedPassword,
		role: "admin",
		isVerified: true,
	});

	console.log("Admin created successfully");
	process.exit();
};

createAdmin();
