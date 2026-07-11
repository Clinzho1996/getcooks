// src/utils/emailService.js
import { Resend } from "resend";

let resendInstance = null;

export const getResendInstance = () => {
	if (!resendInstance) {
		if (!process.env.RESEND_API_KEY) {
			throw new Error("Missing RESEND_API_KEY environment variable");
		}
		resendInstance = new Resend(process.env.RESEND_API_KEY);
	}
	return resendInstance;
};

// Original function for verification OTPs (kept for backward compatibility)
export const sendOTPEmail = async (email, code, customHtml = null) => {
	const resend = getResendInstance();

	// If custom HTML is provided, use it for delivery OTPs
	const htmlContent =
		customHtml ||
		`
		<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
			<h2 style="color: #ff6b35;">Getameal Verification</h2>
			<p>Your OTP code is:</p>
			<h1 style="font-size: 32px; letter-spacing: 5px; color: #333;">${code}</h1>
			<p>This code expires in 10 minutes.</p>
			<hr />
			<p style="color: #666; font-size: 12px;">If you didn't request this, please ignore this email.</p>
		</div>
	`;

	const response = await resend.emails.send({
		from: process.env.EMAIL_FROM,
		to: email,
		subject: customHtml
			? "Your Getameal Delivery OTP"
			: "Your Getameal OTP Code",
		html: htmlContent,
	});

	return response;
};

// New dedicated function for delivery OTPs
export const sendDeliveryOTPEmail = async (
	email,
	otp,
	orderId,
	orderAmount,
	deliveryType,
) => {
	const resend = getResendInstance();

	const htmlContent = `
		<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 10px;">
			<div style="text-align: center; margin-bottom: 30px;">
				<h1 style="color: #ff6b35; margin: 0;">🍽️ Getameal</h1>
				<p style="color: #666; margin: 5px 0 0;">Order Confirmation</p>
			</div>
			
			<div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
				<h2 style="margin: 0 0 10px 0; color: #333;">Your Order has been Confirmed! 🎉</h2>
				<p style="margin: 0; color: #666;">Order #${orderId.slice(-6)}</p>
			</div>
			
			<div style="text-align: center; margin: 30px 0;">
				<p style="font-size: 16px; color: #666; margin-bottom: 10px;">Your Delivery OTP is:</p>
				<div style="background-color: #ff6b35; color: white; font-size: 36px; font-weight: bold; padding: 20px; border-radius: 10px; display: inline-block; letter-spacing: 10px;">
					${otp}
				</div>
			</div>
			
			<div style="background-color: #fff3e0; padding: 15px; border-radius: 8px; margin: 20px 0;">
				<p style="margin: 0 0 10px 0; font-weight: bold;">⚠️ Important Information:</p>
				<ul style="margin: 0; padding-left: 20px;">
					<li>This OTP does <strong>NOT expire</strong> until your order is delivered/picked up</li>
					<li>Share this OTP with the ${deliveryType === "pickup" ? "cook" : "delivery person"} at the time of ${deliveryType === "pickup" ? "pickup" : "delivery"}</li>
					<li><strong>Never share this OTP publicly or with anyone before receiving your order</strong></li>
					<li>This is a one-time use code</li>
				</ul>
			</div>
			
			<div style="background-color: #e8f5e9; padding: 15px; border-radius: 8px; margin: 20px 0;">
				<p style="margin: 0; font-weight: bold;">Order Summary:</p>
				<p style="margin: 5px 0;">Total Amount: <strong>₦${orderAmount.toFixed(2)}</strong></p>
				<p style="margin: 5px 0;">Delivery Type: <strong>${deliveryType === "pickup" ? "Pickup" : "Delivery"}</strong></p>
			</div>
			
			<hr style="margin: 20px 0; border: none; border-top: 1px solid #e0e0e0;" />
			
			<p style="color: #999; font-size: 12px; text-align: center; margin: 0;">
				Thank you for choosing Getameal!<br />
				If you have any issues, please contact our support team.
			</p>
		</div>
	`;

	const response = await resend.emails.send({
		from: process.env.EMAIL_FROM,
		to: email,
		subject: `🔐 Your Delivery OTP for Order #${orderId.slice(-6)} - Getameal`,
		html: htmlContent,
	});

	return response;
};
