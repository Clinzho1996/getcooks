import express from "express";

import { getBanks, verifyAccount } from "../controllers/bankController.js";

const router = express.Router();

router.get("/", getBanks);

router.post("/verify", verifyAccount);

export default router;
