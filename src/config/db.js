import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// go up to project root
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

const connectDB = async () => {
	if (!process.env.MONGODB_URI) {
		throw new Error("MONGODB_URI is undefined");
	}

	await mongoose.connect(process.env.MONGODB_URI);
	console.log("MongoDB Connected");
};

export default connectDB;
