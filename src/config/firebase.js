import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
	serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

	serviceAccount.private_key = serviceAccount.private_key?.replace(
		/\\n/g,
		"\n",
	);
} else {
	const serviceAccountPath = path.resolve(__dirname, "ServiceAccountKey.json");

	serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf8"));
}

if (!admin.apps.length) {
	admin.initializeApp({
		credential: admin.credential.cert(serviceAccount),
	});

	console.log("🔥 Firebase initialized successfully");
}

export const verifyFirebaseToken = async (idToken) => {
	try {
		if (!admin.apps.length) {
			throw new Error("Firebase not initialized");
		}

		const decoded = await admin.auth().verifyIdToken(idToken);
		return decoded;
	} catch (error) {
		throw new Error("Invalid Firebase token");
	}
};
export default admin;
