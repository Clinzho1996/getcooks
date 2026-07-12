// routes/bankRoutes.js - Complete
import express from "express";
import {
	addCookBankAccount,
	deleteCookBankAccount,
	getBanks,
	getCookBankDetails,
	updateCookBankAccount,
	verifyAccount,
} from "../controllers/bankController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// Public routes (no auth)
router.get("/", getBanks);

// Authenticated routes
router.use(protect);

router.post("/verify", verifyAccount);
router.get("/my-bank", getCookBankDetails);
router.post("/add", addCookBankAccount);
router.put("/update", updateCookBankAccount);
router.delete("/remove", deleteCookBankAccount);

export default router;
