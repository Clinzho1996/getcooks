// utils/whatsappNotifications.js

import whatsappService from "../services/whatsappService.js";
import { formatPhoneNumber } from "./phoneFormatter.js";

// ✅ Send WhatsApp notification to cook
export const sendWhatsAppToCook = async (cook, message, order = null) => {
	try {
		const phone = cook.phone || cook.userId?.phone;
		if (!phone) {
			console.error("❌ Cook phone number not found");
			return false;
		}

		const formattedPhone = formatPhoneNumber(phone);
		if (!formattedPhone) {
			console.error("❌ Invalid cook phone number");
			return false;
		}

		// ✅ Always include store name in message
		const storeName = cook.storeName || "Your Store";
		const fullMessage = `${message}\n\n- ${storeName}`;

		await whatsappService.sendWhatsApp(formattedPhone, fullMessage);
		console.log(`✅ WhatsApp sent to cook: ${cook.storeName}`);
		return true;
	} catch (error) {
		console.error("❌ Failed to send WhatsApp to cook:", error.message);
		return false;
	}
};

// ✅ Send WhatsApp notification to customer
export const sendWhatsAppToCustomer = async (customer, message) => {
	try {
		const phone = customer.phone || customer.customerPhone;
		if (!phone) {
			console.error("❌ Customer phone number not found");
			return false;
		}

		const formattedPhone = formatPhoneNumber(phone);
		if (!formattedPhone) {
			console.error("❌ Invalid customer phone number");
			return false;
		}

		await whatsappService.sendWhatsApp(formattedPhone, message);
		console.log(
			`✅ WhatsApp sent to customer: ${customer.customerName || "Customer"}`,
		);
		return true;
	} catch (error) {
		console.error("❌ Failed to send WhatsApp to customer:", error.message);
		return false;
	}
};

// ✅ Send order status update to customer
export const sendOrderStatusUpdate = async (order, cook, status) => {
	const statusMessages = {
		confirmed: `Your order has been confirmed by ${cook.storeName}! We'll start preparing it soon.`,
		preparing: `${cook.storeName} is now preparing your order!`,
		ready: `🍽️ Your order is ready for pickup/delivery from ${cook.storeName}!`,
		delivered: `Your order has been delivered! Enjoy your meal!`,
		picked_up: `You've picked up your order from ${cook.storeName}! Enjoy!`,
		cancelled: `Your order has been cancelled.`,
		out_for_delivery: `Your order is out for delivery from ${cook.storeName}!`,
	};

	const message =
		statusMessages[status] ||
		`Your order status has been updated to: ${status}`;
	const receiptUrl = `https://getameal-web.vercel.app/receipt/${order._id}?phone=${order.customerPhone}`;

	const fullMessage = `${message}\n\n📱 View your receipt: ${receiptUrl}`;

	return await sendWhatsAppToCustomer(order, fullMessage);
};

// ✅ Send new order notification to cook
export const sendNewOrderToCook = async (cook, order) => {
	const message = `New Order Received!\n\nCustomer: ${order.customerName}\nOrder: ${order.customOrderTitle || "Custom Order"}\nAmount: ₦${order.totalAmount.toFixed(2)}\nReady: ${new Date(order.readyDate).toLocaleDateString()}\n\n📱 View order: https://getameal-web.vercel.app/dashboard/orders/${order._id}`;

	return await sendWhatsAppToCook(cook, message);
};

// ✅ Send payment confirmation to cook
export const sendPaymentConfirmationToCook = async (cook, order) => {
	const message = `Payment Confirmed!\n\nCustomer: ${order.customerName}\nOrder: ${order.customOrderTitle || "Custom Order"}\nAmount: ₦${order.totalAmount.toFixed(2)}\n\nStart preparing the order now!`;

	return await sendWhatsAppToCook(cook, message);
};

// ✅ Send wallet credit notification to cook
export const sendWalletCreditToCook = async (cook, order, amount) => {
	const message = `Payment Received!\n\nYou earned ₦${amount.toFixed(2)} from order #${order._id.toString().slice(-6)}\n\nNew balance: ₦${cook.walletBalance?.toFixed(2) || "0.00"}`;

	return await sendWhatsAppToCook(cook, message);
};

// ✅ Send custom order creation to customer
export const sendCustomOrderToCustomer = async (customer, cook, order) => {
	const formattedPaymentLink = `https://getameal-web.vercel.app/pay/${order._id}?kitchen=${cook.storeHandle}&link=${encodeURIComponent(order.paymentLink)}`;
	const receiptUrl = `https://getameal-web.vercel.app/receipt/${order._id}?phone=${order.customerPhone}`;

	const message = `Hi ${customer.customerName}!

Your custom order has been created by ${cook.storeName}!

Order Details:
• Order: ${order.customOrderTitle}
• Amount: ₦${order.totalAmount.toFixed(2)}
• Ready: ${new Date(order.readyDate).toLocaleDateString()}

Pay here: ${formattedPaymentLink}

View your receipt: ${receiptUrl}

Thank you for choosing ${cook.storeName}!`;

	return await sendWhatsAppToCustomer(customer, message);
};
