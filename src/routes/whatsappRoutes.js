// routes/whatsappRoutes.js
import express from "express";

const router = express.Router();

// Webhook verification (GET)
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ Webhook verified");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Incoming messages (POST)
router.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object === "whatsapp_business_account") {
    body.entry?.forEach((entry) => {
      entry.changes?.forEach((change) => {
        const value = change.value;
        // handle incoming messages here
        console.log("Incoming:", JSON.stringify(value, null, 2));
      });
    });
    return res.sendStatus(200);
  }

  return res.sendStatus(404);
});

export default router;