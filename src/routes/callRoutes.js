// routes/callRoutes.js
import express from "express";
import {
	generateCallToken,
	updateCallStatus,
} from "../controllers/callController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// Generate Agora token for a call
router.post("/token", protect, generateCallToken);
// routes/callRoutes.js
router.post("/logs", protect, updateCallStatus);

export default router;
