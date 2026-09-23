// controllers/contactController.js
import { Resend } from "resend";
import ContactMessage from "../models/ContactMessage.js";
import { createAdminNotification } from "../utils/adminNotification.js";

let resend = null;
const getResend = () => {
	if (!resend) {
		if (!process.env.RESEND_API_KEY) {
			throw new Error("Missing RESEND_API_KEY");
		}
		resend = new Resend(process.env.RESEND_API_KEY);
	}
	return resend;
};

const TOPICS = [
	"General enquiry",
	"Seller support",
	"Customer order issue",
	"Payments & payouts",
	"Partnerships",
];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^[0-9+\s()-]{6,30}$/;

// ============================================
// SUBMIT CONTACT MESSAGE (Public)
// ============================================
export const submitContactMessage = async (req, res) => {
	try {
		const { name, email, phone, topic, message, website } = req.body;

		// Honeypot — silently succeed for bots
		if (website && website.trim().length > 0) {
			console.log("🤖 Honeypot triggered — ignoring submission");
			return res.status(200).json({
				success: true,
				message: "Message received",
			});
		}

		// Validate required fields
		const errors = {};

		if (!name || typeof name !== "string" || name.trim().length < 2) {
			errors.name = "Please enter your full name";
		} else if (name.trim().length > 100) {
			errors.name = "Name is too long";
		}

		if (!email || typeof email !== "string") {
			errors.email = "Please enter your email address";
		} else if (!EMAIL_REGEX.test(email.trim())) {
			errors.email = "Please enter a valid email address";
		} else if (email.trim().length > 255) {
			errors.email = "Email is too long";
		}

		if (phone && phone.trim().length > 0) {
			if (!PHONE_REGEX.test(phone.trim())) {
				errors.phone = "Please enter a valid phone number";
			} else if (phone.trim().length > 30) {
				errors.phone = "Phone number is too long";
			}
		}

		if (!topic || !TOPICS.includes(topic)) {
			errors.topic = "Please select a topic";
		}

		if (!message || typeof message !== "string" || message.trim().length < 10) {
			errors.message = "Please tell us a bit more (at least 10 characters)";
		} else if (message.trim().length > 2000) {
			errors.message = "Message is too long (2000 characters max)";
		}

		if (Object.keys(errors).length > 0) {
			return res.status(400).json({
				success: false,
				message: "Please fix the errors below",
				errors,
			});
		}

		// Save to database
		const contactMessage = await ContactMessage.create({
			name: name.trim(),
			email: email.toLowerCase().trim(),
			phone: phone ? phone.trim() : "",
			topic,
			message: message.trim(),
			ipAddress:
				req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
				req.socket?.remoteAddress ||
				null,
			userAgent: req.headers["user-agent"] || null,
			status: "new",
		});

		console.log(`📩 New contact message from ${contactMessage.email}`);

		// ✅ Send email to support
		try {
			const resendClient = getResend();
			const supportEmail = process.env.SUPPORT_EMAIL || "support@getameal.app";

			await resendClient.emails.send({
				from: process.env.EMAIL_FROM,
				to: supportEmail,
				replyTo: contactMessage.email,
				subject: `[Contact] ${topic} — ${contactMessage.name}`,
				html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #ff6b35; margin: 0 0 16px;">New contact message</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 15px;">
              <tr>
                <td style="padding: 8px 0; color: #666; width: 120px;">Name</td>
                <td style="padding: 8px 0;"><strong>${contactMessage.name}</strong></td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #666;">Email</td>
                <td style="padding: 8px 0;">
                  <a href="mailto:${contactMessage.email}" style="color: #ff6b35;">${contactMessage.email}</a>
                </td>
              </tr>
              ${
								contactMessage.phone
									? `<tr>
                      <td style="padding: 8px 0; color: #666;">Phone</td>
                      <td style="padding: 8px 0;">${contactMessage.phone}</td>
                    </tr>`
									: ""
							}
              <tr>
                <td style="padding: 8px 0; color: #666;">Topic</td>
                <td style="padding: 8px 0;"><strong>${contactMessage.topic}</strong></td>
              </tr>
            </table>
            <hr style="margin: 20px 0; border: none; border-top: 1px solid #e0e0e0;" />
            <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Message</p>
            <div style="background-color: #f9f9f9; padding: 16px; border-radius: 8px; white-space: pre-line; font-size: 15px; line-height: 1.6;">
              ${contactMessage.message}
            </div>
            <hr style="margin: 24px 0; border: none; border-top: 1px solid #e0e0e0;" />
            <p style="font-size: 12px; color: #999; margin: 0;">
              Message ID: ${contactMessage._id}<br />
              Reply directly to this email to respond to ${contactMessage.name}.
            </p>
          </div>
        `,
			});
			console.log(`✅ Support email sent for message ${contactMessage._id}`);
		} catch (emailError) {
			console.error("❌ Failed to send support email:", emailError.message);
		}

		// ✅ Send confirmation email to sender
		try {
			const resendClient = getResend();
			await resendClient.emails.send({
				from: process.env.EMAIL_FROM,
				to: contactMessage.email,
				subject: "We received your message — Getameal",
				html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #ff6b35; margin: 0 0 16px;">Thanks for reaching out</h2>
            <p style="font-size: 15px; line-height: 1.6; color: #333;">
              Hi ${contactMessage.name.split(" ")[0]},
            </p>
            <p style="font-size: 15px; line-height: 1.6; color: #333;">
              We've received your message about <strong>${contactMessage.topic}</strong>.
              Our support team will reply within 24 hours.
            </p>
            <div style="background-color: #f9f9f9; padding: 16px; border-radius: 8px; margin: 20px 0; white-space: pre-line; font-size: 14px; line-height: 1.6; color: #555;">
              ${contactMessage.message}
            </div>
            <p style="font-size: 15px; line-height: 1.6; color: #333;">
              If you need to add anything, just reply to this email.
            </p>
            <hr style="margin: 24px 0; border: none; border-top: 1px solid #e0e0e0;" />
            <p style="font-size: 12px; color: #999; margin: 0;">
              Getameal Support<br />
              Mon – Sat, 8am – 8pm WAT
            </p>
          </div>
        `,
			});
			console.log(`✅ Confirmation email sent to ${contactMessage.email}`);
		} catch (emailError) {
			console.error(
				"❌ Failed to send confirmation email:",
				emailError.message,
			);
		}

		// ✅ Admin notification (in-app)
		try {
			await createAdminNotification({
				title: "New Contact Message",
				body: `${contactMessage.name} (${contactMessage.email}) — ${contactMessage.topic}`,
				type: "user",
				data: {
					contactMessageId: contactMessage._id,
					email: contactMessage.email,
					topic: contactMessage.topic,
				},
			});
		} catch (adminError) {
			console.error("Failed to create admin notification:", adminError.message);
		}

		return res.status(201).json({
			success: true,
			message: "Message sent successfully",
			data: {
				id: contactMessage._id,
				name: contactMessage.name,
				email: contactMessage.email,
				topic: contactMessage.topic,
				status: contactMessage.status,
				createdAt: contactMessage.createdAt,
			},
		});
	} catch (error) {
		console.error("Submit contact message error:", error);
		return res.status(500).json({
			success: false,
			message: "Failed to send message. Please try again.",
			error: error.message,
		});
	}
};

// ============================================
// GET ALL CONTACT MESSAGES (Admin)
// ============================================
export const getContactMessages = async (req, res) => {
	try {
		const { status, search, limit = 20, page = 1 } = req.query;

		const query = {};
		if (status && status !== "all") query.status = status;

		if (search) {
			query.$or = [
				{ name: { $regex: search, $options: "i" } },
				{ email: { $regex: search, $options: "i" } },
				{ message: { $regex: search, $options: "i" } },
			];
		}

		const messages = await ContactMessage.find(query)
			.sort({ createdAt: -1 })
			.skip((page - 1) * limit)
			.limit(parseInt(limit))
			.populate("repliedBy", "fullName email");

		const total = await ContactMessage.countDocuments(query);

		const unreadCount = await ContactMessage.countDocuments({ status: "new" });

		res.json({
			success: true,
			messages,
			unreadCount,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error("Get contact messages error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// GET SINGLE CONTACT MESSAGE (Admin)
// ============================================
export const getContactMessageById = async (req, res) => {
	try {
		const { id } = req.params;

		const message = await ContactMessage.findById(id).populate(
			"repliedBy",
			"fullName email",
		);

		if (!message) {
			return res.status(404).json({ message: "Message not found" });
		}

		// Auto-mark as read
		if (message.status === "new") {
			message.status = "read";
			await message.save();
		}

		res.json({
			success: true,
			message,
		});
	} catch (error) {
		console.error("Get contact message error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// UPDATE CONTACT MESSAGE STATUS (Admin)
// ============================================
export const updateContactMessageStatus = async (req, res) => {
	try {
		const { id } = req.params;
		const { status, adminNote } = req.body;

		const validStatuses = ["new", "read", "replied", "closed"];
		if (status && !validStatuses.includes(status)) {
			return res.status(400).json({
				message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
			});
		}

		const message = await ContactMessage.findById(id);
		if (!message) {
			return res.status(404).json({ message: "Message not found" });
		}

		if (status) message.status = status;
		if (adminNote !== undefined) message.adminNote = adminNote;

		if (status === "replied") {
			message.repliedAt = new Date();
			message.repliedBy = req.user._id;
		}

		await message.save();

		res.json({
			success: true,
			message: "Contact message updated",
			data: message,
		});
	} catch (error) {
		console.error("Update contact message error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// DELETE CONTACT MESSAGE (Admin)
// ============================================
export const deleteContactMessage = async (req, res) => {
	try {
		const { id } = req.params;

		const message = await ContactMessage.findByIdAndDelete(id);
		if (!message) {
			return res.status(404).json({ message: "Message not found" });
		}

		res.json({
			success: true,
			message: "Contact message deleted",
		});
	} catch (error) {
		console.error("Delete contact message error:", error);
		res.status(500).json({ message: error.message });
	}
};
