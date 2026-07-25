// services/whatsappService.js

import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

// ✅ Choose your WhatsApp provider
// Option 1: Twilio (recommended for developers)
// Option 2: Meta/WhatsApp Cloud API
// Option 3: Africa's Talking (for African countries)

class WhatsAppService {
	constructor() {
		// ✅ Using Twilio as example
		this.accountSid = process.env.TWILIO_ACCOUNT_SID;
		this.authToken = process.env.TWILIO_AUTH_TOKEN;
		this.fromNumber = process.env.TWILIO_WHATSAPP_NUMBER; // e.g., +14155238886

		// ✅ OR using Meta WhatsApp Cloud API
		this.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
		this.accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
		this.apiVersion = "v18.0";

		this.provider = process.env.WHATSAPP_PROVIDER || "twilio"; // twilio, meta, africas_talking
	}

	// ✅ Format phone number for WhatsApp (remove + and 234)
	formatPhoneNumber(phone) {
		if (!phone) return null;
		let cleaned = phone.replace(/\D/g, "");
		if (cleaned.startsWith("0")) {
			cleaned = cleaned.substring(1);
		}
		if (cleaned.startsWith("234")) {
			cleaned = cleaned.substring(3);
		}
		return cleaned;
	}

	// ✅ Send WhatsApp message via Twilio
	async sendViaTwilio(to, message) {
		try {
			const formattedTo = this.formatPhoneNumber(to);
			const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;

			const response = await axios.post(
				url,
				new URLSearchParams({
					To: `whatsapp:+${formattedTo}`,
					From: `whatsapp:${this.fromNumber}`,
					Body: message,
				}),
				{
					auth: {
						username: this.accountSid,
						password: this.authToken,
					},
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
					},
				},
			);

			console.log(`✅ WhatsApp sent via Twilio to ${to}`);
			return response.data;
		} catch (error) {
			console.error(
				"❌ Twilio WhatsApp error:",
				error.response?.data || error.message,
			);
			throw error;
		}
	}

	// ✅ Send WhatsApp message via Meta Cloud API
	async sendViaMeta(to, message) {
		try {
			const formattedTo = this.formatPhoneNumber(to);
			const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

			const response = await axios.post(
				url,
				{
					messaging_product: "whatsapp",
					to: formattedTo,
					type: "text",
					text: { body: message },
				},
				{
					headers: {
						Authorization: `Bearer ${this.accessToken}`,
						"Content-Type": "application/json",
					},
				},
			);

			console.log(`✅ WhatsApp sent via Meta to ${to}`);
			return response.data;
		} catch (error) {
			console.error(
				"❌ Meta WhatsApp error:",
				error.response?.data || error.message,
			);
			throw error;
		}
	}

	// ✅ Send WhatsApp message via Africa's Talking
	async sendViaAfricasTalking(to, message) {
		try {
			const formattedTo = this.formatPhoneNumber(to);
			const url = "https://api.africastalking.com/version1/messaging";

			const response = await axios.post(
				url,
				new URLSearchParams({
					username: process.env.AFRICAS_TALKING_USERNAME,
					to: `+${formattedTo}`,
					message: message,
					from: process.env.AFRICAS_TALKING_SENDER_ID,
				}),
				{
					headers: {
						"Content-Type": "application/x-www-form-urlencoded",
						apiKey: process.env.AFRICAS_TALKING_API_KEY,
					},
				},
			);

			console.log(`✅ WhatsApp sent via Africa's Talking to ${to}`);
			return response.data;
		} catch (error) {
			console.error(
				"❌ Africa's Talking error:",
				error.response?.data || error.message,
			);
			throw error;
		}
	}

	// ✅ Main send method
	async sendWhatsApp(to, message) {
		if (!to) {
			console.error("❌ No phone number provided");
			return null;
		}

		try {
			let response;
			switch (this.provider) {
				case "twilio":
					response = await this.sendViaTwilio(to, message);
					break;
				case "meta":
					response = await this.sendViaMeta(to, message);
					break;
				case "africas_talking":
					response = await this.sendViaAfricasTalking(to, message);
					break;
				default:
					console.log(
						`📱 WhatsApp message to ${to}: ${message.substring(0, 50)}...`,
					);
					// For development - just log the message
					response = { success: true, message: "Logged only" };
			}
			return response;
		} catch (error) {
			console.error("❌ WhatsApp send error:", error.message);
			return null;
		}
	}

	// ✅ Send template message (for Meta Cloud API)
	async sendTemplate(to, templateName, components = []) {
		try {
			const formattedTo = this.formatPhoneNumber(to);
			const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

			const response = await axios.post(
				url,
				{
					messaging_product: "whatsapp",
					to: formattedTo,
					type: "template",
					template: {
						name: templateName,
						language: { code: "en" },
						components: components,
					},
				},
				{
					headers: {
						Authorization: `Bearer ${this.accessToken}`,
						"Content-Type": "application/json",
					},
				},
			);

			console.log(`✅ WhatsApp template sent to ${to}`);
			return response.data;
		} catch (error) {
			console.error(
				"❌ Template error:",
				error.response?.data || error.message,
			);
			throw error;
		}
	}
}

// ✅ Export singleton instance
const whatsappService = new WhatsAppService();
export default whatsappService;
