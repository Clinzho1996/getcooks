import express from "express";

import {
	getCitiesByState,
	getNearbyCooks,
	getStates,
	saveLocation,
	updateLocation,
} from "../controllers/locationController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.get("/states", protect, getStates);

router.get("/cities/:stateCode", getCitiesByState);

router.post("/save", protect, saveLocation);
router.put("/update", protect, updateLocation);

router.get("/nearby-cooks", protect, getNearbyCooks);

export default router;
