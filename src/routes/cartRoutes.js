// routes/cartRoutes.js - Public (No Auth)
import express from "express";
import {
	addToCart,
	clearCart,
	getCart,
	removeFromCart,
} from "../controllers/cartController.js";

const router = express.Router();

// All cart routes are public - customer identified by session/temp ID
router.post("/", addToCart);
router.get("/:sessionId", getCart);
router.delete("/:sessionId/:productId", removeFromCart);
router.delete("/:sessionId", clearCart);

export default router;
