// routes/contactRoutes.js
import express from "express";
import {
	deleteContactMessage,
	getContactMessageById,
	getContactMessages,
	submitContactMessage,
	updateContactMessageStatus,
} from "../controllers/contactController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// ============================================
// PUBLIC
// ============================================
router.post("/", submitContactMessage);

// ============================================
// ADMIN (authenticated)
// ============================================
router.get("/", protect, getContactMessages);
router.get("/:id", protect, getContactMessageById);
router.patch("/:id", protect, updateContactMessageStatus);
router.delete("/:id", protect, deleteContactMessage);

export default router;
