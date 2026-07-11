// middleware/upload.js
import fs from "fs";
import multer from "multer";
import path from "path";

// Ensure upload directory exists
const ensureDirectoryExists = (dir) => {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
};

// Temporary storage on server
const storage = multer.diskStorage({
	destination: function (req, file, cb) {
		const uploadPath = "uploads/";
		ensureDirectoryExists(uploadPath);
		cb(null, uploadPath);
	},
	filename: function (req, file, cb) {
		const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
		const ext = path.extname(file.originalname);
		cb(null, file.fieldname + "-" + uniqueSuffix + ext);
	},
});

// File filter for images
const fileFilter = (req, file, cb) => {
	const allowedTypes = /jpeg|jpg|png|gif|webp/;
	const extname = allowedTypes.test(
		path.extname(file.originalname).toLowerCase(),
	);
	const mimetype = allowedTypes.test(file.mimetype);

	if (mimetype && extname) {
		return cb(null, true);
	} else {
		cb(new Error("Only image files are allowed (jpeg, jpg, png, gif, webp)"));
	}
};

const upload = multer({
	storage: storage,
	limits: {
		fileSize: 10 * 1024 * 1024, // 10MB limit
	},
	fileFilter: fileFilter,
});

// Create a middleware function that handles multer errors
export const uploadMiddleware = (fields) => {
	return (req, res, next) => {
		const uploadHandler = upload.fields(fields);

		uploadHandler(req, res, (err) => {
			if (err instanceof multer.MulterError) {
				// A Multer error occurred when uploading
				console.error("Multer error:", err);
				return res.status(400).json({
					success: false,
					message: `Upload error: ${err.message}`,
					field: err.field,
				});
			} else if (err) {
				// An unknown error occurred
				console.error("Unknown upload error:", err);
				return res.status(500).json({
					success: false,
					message: err.message || "An unknown error occurred during upload",
				});
			}
			// Everything went fine
			next();
		});
	};
};

export { upload };
