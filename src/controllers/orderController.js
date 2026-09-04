// controllers/orderController.js
import axios from "axios";
import crypto from "crypto";
import Cart from "../models/Cart.js";
import CookProfile from "../models/CookProfile.js";
import Customer from "../models/Customer.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import PaymentSession from "../models/PaymentSession.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendNotification } from "../services/notificationService.js";
import { sendPushToUser } from "../services/pushService.js";
import { createAdminNotification } from "../utils/adminNotification.js";
import { sendPaymentConfirmationToCook } from "../utils/whatsappNotifications.js";

// ============================================
// HELPER: Format phone number
// ============================================
const formatPhone = (phone) => {
	const cleaned = phone.replace(/\D/g, "");
	if (cleaned.length === 10) return `0${cleaned}`;
	return cleaned;
};

// ============================================
// HELPER: Calculate order totals
// ============================================
const calculateOrderTotals = (foodSubtotal, deliveryFee, addFeesToCustomer) => {
	let serviceFee = 0;
	let paystackFee = 0;
	let totalAmount = 0;

	if (addFeesToCustomer) {
		serviceFee = foodSubtotal * 0.05;
		paystackFee = (foodSubtotal + serviceFee) * 0.015 + 1;
		totalAmount =
			Math.round(
				(foodSubtotal + serviceFee + paystackFee + deliveryFee) * 100,
			) / 100;
	} else {
		totalAmount = Math.round((foodSubtotal + deliveryFee) * 100) / 100;
		serviceFee = foodSubtotal * 0.05;
		paystackFee = (foodSubtotal + serviceFee) * 0.015 + 1;
	}

	return {
		serviceFee: Math.round(serviceFee * 100) / 100,
		paystackFee: Math.round(paystackFee * 100) / 100,
		totalAmount: totalAmount,
	};
};

// ============================================
// CUSTOMER ORDER CREATION - Creates payment session only
// ============================================
export const createCustomerOrder = async (req, res) => {
	try {
		const {
			cookId,
			customerName,
			customerPhone,
			customerNote,
			deliveryType,
			deliveryAddress,
			readyDate,
			foodRequest,
		} = req.body;

		// Validate required fields
		if (
			!cookId ||
			!customerName ||
			!customerPhone ||
			!deliveryType ||
			!readyDate ||
			!foodRequest
		) {
			return res.status(400).json({
				message:
					"Cook ID, customer name, phone, delivery type, ready date, and food request are required",
			});
		}

		// Validate phone number (11 digits)
		const phoneRegex = /^[0-9]{11}$/;
		const cleanPhone = formatPhone(customerPhone);
		if (!phoneRegex.test(cleanPhone)) {
			return res.status(400).json({
				message: "Please enter a valid 11-digit phone number",
			});
		}

		// Check if cook exists and is available
		const cook = await CookProfile.findOne({ userId: cookId });
		if (!cook) {
			return res.status(404).json({ message: "Cook not found" });
		}
		if (!cook.isAvailable) {
			return res.status(400).json({ message: "Store is currently paused" });
		}
		if (!cook.isApproved) {
			return res.status(400).json({ message: "Store is pending approval" });
		}

		// Validate ready date
		const readyDateTime = new Date(readyDate);
		if (readyDateTime < new Date()) {
			return res
				.status(400)
				.json({ message: "Ready date must be in the future" });
		}

		// Validate delivery address if delivery type is delivery
		if (deliveryType === "delivery" && !deliveryAddress) {
			return res.status(400).json({
				message: "Delivery address is required for delivery orders",
			});
		}

		// Check if customer exists
		let customer = await Customer.findOne({
			cookId,
			phoneNumber: cleanPhone,
		});

		if (!customer) {
			customer = await Customer.create({
				cookId,
				fullName: customerName,
				phoneNumber: cleanPhone,
				isActive: true,
			});
		}

		// Calculate delivery fee
		const deliveryFee = deliveryType === "delivery" ? cook.deliveryFee || 0 : 0;

		// Create payment session (NOT an order yet)
		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();

		const paymentSessionData = {
			sessionType: "customer_order",
			cookId,
			customerId: customer._id,
			customerName,
			customerPhone: cleanPhone,
			customerNote: customerNote || "",
			deliveryType,
			deliveryAddress: deliveryType === "delivery" ? deliveryAddress : null,
			deliveryFee,
			readyDate: readyDateTime,
			readyTime: "12:00",
			pickupWindow: {
				from: cook.pickupWindow.from,
				to: cook.pickupWindow.to,
			},
			foodRequest,
			paymentReference,
			status: "pending",
		};

		const paymentSession = await PaymentSession.create(paymentSessionData);

		// Generate Paystack payment link (placeholder amount)
		const paystackResponse = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email: customer.email || `${cleanPhone}@getameal.com`,
				amount: 10000,
				reference: paymentReference,
				callback_url: `${process.env.API_URL}/payment/callback`,
				metadata: {
					sessionId: paymentSession._id.toString(),
					cookId: cookId.toString(),
					customerName,
					customerPhone: cleanPhone,
					type: "customer_order",
				},
			},
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		paymentSession.paymentLink = paystackResponse.data.data.authorization_url;
		await paymentSession.save();

		// Format payment link with phone
		const encodedPaystackLink = encodeURIComponent(paymentSession.paymentLink);
		const formattedPaymentLink = `https://getameal-web.vercel.app/pay/${paymentSession._id}?kitchen=${cook.storeHandle}&link=${encodedPaystackLink}&phone=${cleanPhone}`;

		// Send WhatsApp to customer (NO EMOJIS)
		const whatsappMessage = `Hi ${customerName}!

Your food request has been received by ${cook.storeName}.

Order Details:
- Food Request: ${foodRequest}
- Delivery: ${deliveryType === "delivery" ? `Delivery to ${deliveryAddress || "your address"}` : "Pickup"}
${deliveryFee > 0 ? `- Delivery Fee: ₦${deliveryFee.toFixed(2)}` : ""}
- Ready: ${readyDateTime.toLocaleDateString()}

Please wait for the cook to confirm and set the price. You will receive a payment link shortly.

Thank you for choosing ${cook.storeName}!`;

		const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(whatsappMessage)}`;

		// Send push notification to cook (NO EMOJIS)
		await sendPushToUser(
			cookId,
			"New Food Request",
			`${customerName} wants: ${foodRequest}`,
			{
				type: "new_order_request",
				sessionId: paymentSession._id.toString(),
				customerName,
				foodRequest,
			},
		);

		res.status(201).json({
			success: true,
			message: "Food request sent to cook successfully",
			session: {
				id: paymentSession._id,
				customerName: paymentSession.customerName,
				customerPhone: paymentSession.customerPhone,
				foodRequest: paymentSession.foodRequest,
				deliveryType: paymentSession.deliveryType,
				deliveryAddress: paymentSession.deliveryAddress || null,
				readyDate: paymentSession.readyDate,
				status: paymentSession.status,
				paymentLink: formattedPaymentLink,
			},
		});
	} catch (error) {
		console.error("Create customer order error:", error);
		res.status(500).json({
			message: "Failed to create food request",
			error: error.message,
		});
	}
};

// ============================================
// ACCEPT ORDER REQUEST - Sets price & creates order
// ============================================
export const acceptOrderRequest = async (req, res) => {
	try {
		const userId = req.user._id;
		const { requestId } = req.params;
		const { amount } = req.body;

		if (!amount || amount <= 0) {
			return res.status(400).json({
				message: "Please set a price for this order",
			});
		}

		const paymentSession = await PaymentSession.findOne({
			_id: requestId,
			cookId: userId,
			status: "pending",
		}).populate("customerId");

		if (!paymentSession) {
			return res.status(404).json({ message: "Food request not found" });
		}

		const cook = await CookProfile.findOne({ userId });
		if (!cook) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		const addFeesToCustomer = cook.fees?.addFeesToCustomer !== false;

		const deliveryFee = paymentSession.deliveryFee || 0;
		const foodSubtotal = amount;
		const { serviceFee, paystackFee, totalAmount } = calculateOrderTotals(
			foodSubtotal,
			deliveryFee,
			addFeesToCustomer,
		);

		// ✅ Generate a NEW payment reference for this order
		const newPaymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();

		// Create the actual order NOW (after price is set)
		const order = await Order.create({
			cookId: userId,
			customerId: paymentSession.customerId._id,
			customerName: paymentSession.customerName,
			customerPhone: paymentSession.customerPhone,
			customerEmail: paymentSession.customerEmail || "",
			customerNote: paymentSession.customerNote || "",
			deliveryType: paymentSession.deliveryType,
			deliveryAddress: paymentSession.deliveryAddress || null,
			deliveryFee: deliveryFee,
			readyDate: paymentSession.readyDate,
			readyTime: paymentSession.readyTime || "12:00",
			status: "pending",
			paymentStatus: "pending",
			orderType: "custom_order",
			customOrderTitle: paymentSession.foodRequest,
			customOrderDescription: paymentSession.customerNote || "",
			subtotal: foodSubtotal,
			serviceFee: serviceFee,
			paystackFee: paystackFee,
			totalAmount: totalAmount,
			feesAddedToCustomer: addFeesToCustomer,
			pickupWindow: paymentSession.pickupWindow,
			sessionId: paymentSession.sessionId || null,
			paymentReference: newPaymentReference, // ✅ Use NEW reference
		});

		// Update payment session with the new reference
		paymentSession.status = "completed";
		paymentSession.orderId = order._id;
		paymentSession.paymentReference = newPaymentReference;
		await paymentSession.save();

		// Update customer stats
		await Customer.findByIdAndUpdate(paymentSession.customerId._id, {
			$inc: { ordersCount: 1, totalSpent: totalAmount },
			$set: { lastOrderDate: new Date() },
		});

		// ✅ Initialize Paystack payment with NEW reference
		const customerEmail =
			paymentSession.customerEmail ||
			`customer_${paymentSession.customerPhone}@getameal.com`;

		const amountInKobo = Math.round(totalAmount * 100);

		if (amountInKobo < 100) {
			return res.status(400).json({
				message: "Amount must be at least ₦1",
			});
		}

		if (amountInKobo > 25000000) {
			return res.status(400).json({
				message: "Amount exceeds maximum limit of ₦250,000",
			});
		}

		console.log("💰 Paystack payment initialization:", {
			email: customerEmail,
			amount: amountInKobo,
			amountInNaira: totalAmount,
			reference: newPaymentReference,
			callback_url: `${process.env.API_URL}/payment/callback`,
		});

		const paystackResponse = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email: customerEmail,
				amount: amountInKobo,
				reference: newPaymentReference,
				callback_url: `${process.env.API_URL}/payment/callback`,
				metadata: {
					orderId: order._id.toString(),
					sessionId: paymentSession._id.toString(),
					cookId: userId.toString(),
					customerName: paymentSession.customerName,
					customerPhone: paymentSession.customerPhone,
				},
			},
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
					"Content-Type": "application/json",
				},
				timeout: 30000,
			},
		);

		if (!paystackResponse.data || !paystackResponse.data.data) {
			console.error("Invalid Paystack response:", paystackResponse.data);
			throw new Error("Paystack returned an invalid response");
		}

		if (!paystackResponse.data.data.authorization_url) {
			console.error(
				"No authorization URL in Paystack response:",
				paystackResponse.data,
			);
			throw new Error("Paystack did not return an authorization URL");
		}

		order.paymentLink = paystackResponse.data.data.authorization_url;
		await order.save();

		const receiptUrl = `https://getameal-web.vercel.app/receipt/${order._id}?phone=${order.customerPhone}`;

		const encodedPaystackLink = encodeURIComponent(order.paymentLink);
		const formattedPaymentLink = `https://getameal-web.vercel.app/pay/${order._id}?kitchen=${cook.storeHandle}&link=${encodedPaystackLink}&phone=${order.customerPhone}`;

		// Send WhatsApp to customer
		const whatsappMessage = `Hi ${paymentSession.customerName}!

Your order has been accepted by ${cook.storeName}.

Order Details:
- Order: ${paymentSession.foodRequest}
- Food Amount: ₦${amount.toFixed(2)}
${deliveryFee > 0 ? `- Delivery Fee: ₦${deliveryFee.toFixed(2)}` : ""}
- Total: ₦${totalAmount.toFixed(2)}
- Ready: ${new Date(paymentSession.readyDate).toLocaleDateString()}

Pay here: ${formattedPaymentLink}

View your receipt: ${receiptUrl}

Thank you for choosing ${cook.storeName}!`;

		const whatsappUrl = `https://wa.me/${paymentSession.customerPhone}?text=${encodeURIComponent(whatsappMessage)}`;

		// Send push notification to cook
		await sendPushToUser(
			userId,
			"Order Accepted",
			`You accepted a custom order from ${paymentSession.customerName}`,
			{
				type: "order_accepted",
				orderId: order._id.toString(),
			},
		);

		res.json({
			success: true,
			message: "Order accepted",
			order: {
				id: order._id,
				customerName: order.customerName,
				customerPhone: order.customerPhone,
				subtotal: order.subtotal,
				deliveryFee: order.deliveryFee,
				serviceFee: order.serviceFee,
				paystackFee: order.paystackFee,
				totalAmount: order.totalAmount,
				feesAddedToCustomer: order.feesAddedToCustomer,
				paymentLink: formattedPaymentLink,
				receiptUrl: receiptUrl,
				status: order.status,
				whatsappUrl: whatsappUrl,
			},
		});
	} catch (error) {
		console.error("Accept order error:", error);

		if (error.response) {
			console.error("Paystack error response:", {
				status: error.response.status,
				data: error.response.data,
				headers: error.response.headers,
			});

			return res.status(error.response.status || 500).json({
				message:
					error.response.data?.message ||
					"Paystack payment initialization failed",
				details: error.response.data,
			});
		}

		res.status(500).json({
			message: error.message || "Failed to accept order",
			error: error.message,
		});
	}
};

// ============================================
// DECLINE ORDER REQUEST
// ============================================
export const declineOrderRequest = async (req, res) => {
	try {
		const userId = req.user._id;
		const { requestId } = req.params;
		const { reason } = req.body;

		const paymentSession = await PaymentSession.findOne({
			_id: requestId,
			cookId: userId,
			status: "pending",
		});

		if (!paymentSession) {
			return res.status(404).json({ message: "Food request not found" });
		}

		const cook = await CookProfile.findOne({ userId });
		if (!cook) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		paymentSession.status = "declined";
		paymentSession.declineReason =
			reason || "Unable to fulfill your order at this time";
		await paymentSession.save();

		// Send WhatsApp message to customer (NO EMOJIS)
		const declineReason = reason || "Unable to fulfill your order at this time";
		const whatsappMessage = `Hi ${paymentSession.customerName}!

Your food request has been declined by ${cook.storeName}.

Reason: ${declineReason}

We apologise for any inconvenience. Please feel free to try another cook.

Thank you for choosing GetAMeal!`;

		const whatsappUrl = `https://wa.me/${paymentSession.customerPhone}?text=${encodeURIComponent(whatsappMessage)}`;

		res.json({
			success: true,
			message: "Food request declined",
			session: paymentSession,
			whatsappUrl: whatsappUrl,
		});
	} catch (error) {
		console.error("Decline order request error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// PAYMENT REDIRECT
// ============================================
export const paymentRedirect = async (req, res) => {
	try {
		const { orderId, reference, status } = req.query;
		const redirectUrl = `https://getameal-web.vercel.app/order-confirmed?orderId=${orderId}&reference=${reference}&status=${status || "success"}`;
		return res.redirect(redirectUrl);
	} catch (error) {
		console.error("Redirect error:", error);
		res.status(500).send("Redirect failed");
	}
};

export const handlePaymentCallback = async (req, res) => {
	try {
		const method = req.method;

		console.log("Payment callback received:", {
			method: method,
			query: req.query,
			body: req.body,
		});

		let reference =
			req.query.reference || req.body?.reference || req.body?.data?.reference;

		if (!reference) {
			return res.status(400).json({
				message: "Missing payment reference",
				received: req.query,
				body: req.body,
			});
		}

		console.log(`Verifying payment for reference: ${reference}`);

		const verify = await axios.get(
			`https://api.paystack.co/transaction/verify/${reference}`,
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		const paymentData = verify.data?.data;

		if (!paymentData) {
			console.error("Invalid Paystack response:", verify.data);
			return res.status(400).json({ message: "Invalid Paystack response" });
		}

		console.log(`Payment data:`, {
			status: paymentData.status,
			amount: paymentData.amount,
			reference: paymentData.reference,
			metadata: paymentData.metadata,
		});

		if (paymentData.status !== "success") {
			return res.status(400).json({ message: "Payment not successful" });
		}

		const metaOrderId = paymentData.metadata?.orderId;
		const metaSessionId = paymentData.metadata?.sessionId;

		if (!metaOrderId && !metaSessionId) {
			console.error("Order ID not found in metadata:", paymentData.metadata);
			return res.status(400).json({
				message: "Order ID not found in payment metadata",
				metadata: paymentData.metadata,
			});
		}

		let order = null;

		// If order already exists (from cart flow), find it
		if (metaOrderId) {
			order = await Order.findById(metaOrderId)
				.populate("items.productId")
				.populate("cookId")
				.populate("customerId");
		}

		// If no order yet, check if there's a payment session (customer order flow)
		if (!order && metaSessionId) {
			const paymentSession =
				await PaymentSession.findById(metaSessionId).populate("customerId");

			if (paymentSession && paymentSession.status === "pending") {
				// Order hasn't been created yet - create it now
				const cook = await CookProfile.findOne({
					userId: paymentSession.cookId,
				});
				if (!cook) {
					return res.status(404).json({ message: "Cook not found" });
				}

				const addFeesToCustomer = cook.fees?.addFeesToCustomer !== false;
				const deliveryFee = paymentSession.deliveryFee || 0;
				const foodSubtotal = 0;

				const { serviceFee, paystackFee, totalAmount } = calculateOrderTotals(
					foodSubtotal,
					deliveryFee,
					addFeesToCustomer,
				);

				// Create the order
				order = await Order.create({
					cookId: paymentSession.cookId,
					customerId: paymentSession.customerId._id,
					customerName: paymentSession.customerName,
					customerPhone: paymentSession.customerPhone,
					customerEmail: paymentSession.customerEmail || "",
					customerNote: paymentSession.customerNote || "",
					deliveryType: paymentSession.deliveryType,
					deliveryAddress: paymentSession.deliveryAddress || null,
					deliveryFee: deliveryFee,
					readyDate: paymentSession.readyDate,
					readyTime: paymentSession.readyTime || "12:00",
					status: "confirmed",
					paymentStatus: "paid",
					orderType: "custom_order",
					customOrderTitle: paymentSession.foodRequest,
					customOrderDescription: paymentSession.customerNote || "",
					subtotal: foodSubtotal,
					serviceFee: serviceFee,
					paystackFee: paystackFee,
					totalAmount: totalAmount,
					feesAddedToCustomer: addFeesToCustomer,
					pickupWindow: paymentSession.pickupWindow,
					paymentReference: reference,
				});

				// Update payment session
				paymentSession.status = "completed";
				paymentSession.orderId = order._id;
				await paymentSession.save();

				// Update customer stats
				await Customer.findByIdAndUpdate(paymentSession.customerId._id, {
					$inc: { ordersCount: 1, totalSpent: totalAmount },
					$set: { lastOrderDate: new Date() },
				});
			}
		}

		if (!order) {
			console.error(`Order not found: ${metaOrderId || metaSessionId}`);
			return res.status(404).json({ message: "Order not found" });
		}

		if (order.paymentStatus === "paid") {
			console.log(`Order ${order._id} already processed`);

			if (method === "POST") {
				return res.status(200).json({
					message: "Already processed",
					order: {
						id: order._id,
						status: order.status,
						paymentStatus: order.paymentStatus,
					},
				});
			}

			return res.redirect(
				`https://getameal-web.vercel.app/order-confirmed?orderId=${order._id}&status=success&message=Already+processed`,
			);
		}

		// Update order with payment
		const paidAmount = Math.round((paymentData.amount / 100) * 100) / 100;
		const expectedAmount = Math.round(order.totalAmount * 100) / 100;

		console.log(
			`Amount comparison: Expected ${expectedAmount}, Paid ${paidAmount}`,
		);

		const difference = Math.abs(paidAmount - expectedAmount);
		if (difference > 0.01) {
			console.error(
				`Amount mismatch: Expected ${expectedAmount}, Paid ${paidAmount}`,
			);
		}

		order.paymentStatus = "paid";
		order.status = "confirmed";
		order.paymentReference = reference;
		await order.save();

		console.log(
			`Order ${order._id} updated: paymentStatus=paid, status=confirmed`,
		);

		// Get cook profile for notifications
		const cook = await CookProfile.findOne({ userId: order.cookId });

		// Send push notification to cook
		try {
			const cookUser = await User.findById(order.cookId);
			if (cookUser) {
				await sendPushToUser(
					order.cookId,
					"New Paid Order",
					`${order.customerName} placed an order for ₦${order.totalAmount.toFixed(2)}`,
					{
						type: "new_paid_order",
						orderId: order._id.toString(),
						amount: order.totalAmount.toFixed(2),
					},
				);
				console.log(`Push notification sent to cook: ${order.cookId}`);
			}
		} catch (pushError) {
			console.error("Push notification error:", pushError.message);
		}

		// Send WhatsApp confirmation to cook
		try {
			if (cook) {
				await sendPaymentConfirmationToCook(cook, order);
			}
		} catch (whatsappError) {
			console.error("WhatsApp notification error:", whatsappError.message);
		}

		// In handlePaymentCallback - use valid types
		try {
			if (order.customerId) {
				await sendNotification(
					order.customerId,
					"Order Confirmed",
					`Your order has been confirmed by ${cook?.storeName || "the cook"}! We'll start preparing it soon.`,
					"order_confirmed", // ✅ This is valid
					{ orderId: order._id },
				);
				console.log(
					`✅ Notification created for customer: ${order.customerId}`,
				);
			}
		} catch (notifError) {
			console.error(
				"Failed to create customer notification:",
				notifError.message,
			);
		}

		// ✅ Use notification service for admin
		try {
			await createAdminNotification({
				type: "order_paid",
				orderId: order._id.toString(),
				message: `Order #${order._id.toString().slice(-6)} paid: ₦${order.totalAmount.toFixed(2)}`,
			});
		} catch (adminError) {
			console.error("Failed to create admin notification:", adminError.message);
		}

		if (method === "POST") {
			return res.status(200).json({
				message: "Payment verified successfully",
				order: {
					id: order._id,
					customerName: order.customerName,
					totalAmount: Math.round(order.totalAmount * 100) / 100,
					status: order.status,
					paymentStatus: order.paymentStatus,
				},
			});
		}

		return res.redirect(
			`https://getameal-web.vercel.app/order-confirmed?orderId=${order._id}&status=success&message=Payment+verified`,
		);
	} catch (error) {
		console.error(
			"Payment callback error:",
			error?.response?.data || error.message,
		);

		if (req.method === "POST") {
			return res.status(500).json({
				message: "Payment verification failed",
				error: error.message,
			});
		}

		return res.redirect(
			`https://getameal-web.vercel.app/order-confirmed?status=failed&message=${encodeURIComponent(error.message)}`,
		);
	}
};

// ============================================
// GET CUSTOMER ORDER DETAILS
// ============================================
export const getCustomerOrderDetails = async (req, res) => {
	try {
		const { orderId } = req.params;
		const { phone } = req.query;

		if (!phone) {
			return res.status(400).json({ message: "Phone number is required" });
		}

		const order = await Order.findOne({
			_id: orderId,
			customerPhone: formatPhone(phone),
		})
			.populate("cookId", "fullName email phone profileImage")
			.populate("customerId", "fullName phoneNumber email")
			.populate("items.productId", "name images description");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		const cookProfile = await CookProfile.findOne({ userId: order.cookId });

		const rawPaymentLink = order.paymentLink || null;

		let formattedPaymentLink = null;
		if (rawPaymentLink && cookProfile) {
			const encodedPaystackLink = encodeURIComponent(rawPaymentLink);
			formattedPaymentLink = `https://getameal-web.vercel.app/pay/${order._id}?kitchen=${cookProfile.storeHandle}&link=${encodedPaystackLink}`;
		}

		const isPaid = order.paymentStatus === "paid";

		res.json({
			success: true,
			order: {
				id: order._id,

				customer: {
					id: order.customerId?._id || null,
					fullName: order.customerName,
					phone: order.customerPhone,
					email: order.customerEmail || null,
					note: order.customerNote || null,
				},

				items: order.items.map((item) => ({
					id: item._id,
					productId: item.productId?._id || null,
					name: item.name,
					quantity: item.quantity,
					price: item.price,
					addOns: item.addOns || [],
					subtotal: item.subtotal,
					productImage: item.productId?.images?.[0]?.url || null,
				})),

				customOrderTitle: order.customOrderTitle || null,
				customOrderDescription: order.customOrderDescription || null,

				deliveryType: order.deliveryType,
				deliveryAddress: order.deliveryAddress || null,
				deliveryFee: order.deliveryFee || 0,
				pickupWindow: order.pickupWindow || null,

				readyDate: order.readyDate,
				readyTime: order.readyTime || "12:00",
				createdAt: order.createdAt,

				subtotal: order.subtotal,
				serviceFee: order.serviceFee,
				paystackFee: order.paystackFee || 0,
				totalAmount: order.totalAmount,

				paymentStatus: order.paymentStatus,
				paymentMethod: order.paymentMethod || "paystack",
				paymentReference: order.paymentReference || null,
				paymentLink: formattedPaymentLink,
				rawPaymentLink: rawPaymentLink,
				isPaid: isPaid,

				status: order.status,
				statusHistory: {
					current: order.status,
					previous: order.oldStatus || null,
				},

				customerNote: order.customerNote || null,
				sellerNote: order.sellerNote || null,

				cook: {
					id: order.cookId._id,
					fullName: order.cookId.fullName,
					email: order.cookId.email,
					phone: order.cookId.phone,
					profileImage: order.cookId.profileImage || null,
					storeName: cookProfile?.storeName || null,
					storeHandle: cookProfile?.storeHandle || null,
					storeLink: cookProfile?.storeLink || null,
					kitchenAddress: cookProfile?.kitchenAddress || null,
					pickupLandmark: cookProfile?.pickupLandmark || null,
					pickupWindow: cookProfile?.pickupWindow || null,
					pickupEnabled: cookProfile?.pickupEnabled !== false,
					deliveryEnabled: cookProfile?.deliveryEnabled || false,
					rating: cookProfile?.rating || 0,
					reviewsCount: cookProfile?.reviewsCount || 0,
					isApproved: cookProfile?.isApproved || false,
					isAvailable: cookProfile?.isAvailable || false,
				},

				receiptUrl: `https://getameal-web.vercel.app/receipt/${order._id}?phone=${order.customerPhone}`,

				feesAddedToCustomer: order.feesAddedToCustomer !== false,
			},
		});
	} catch (error) {
		console.error("Get customer order details error:", error);
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
};

export const createCustomOrder = async (req, res) => {
	try {
		const userId = req.user._id;
		const {
			customerId,
			customerName,
			customerPhone,
			title,
			description,
			amount,
			deliveryType,
			deliveryFee,
			readyDate,
			readyTime,
			pickupWindow,
			customerNote,
		} = req.body;

		if (!customerName || !customerPhone || !title || !amount || !readyDate) {
			return res.status(400).json({
				message:
					"Customer name, phone, title, amount, and ready date are required",
			});
		}

		const cook = await CookProfile.findOne({ userId });
		if (!cook) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		const addFeesToCustomer = cook.fees?.addFeesToCustomer !== false;

		// Find or create customer
		let customer = null;
		const cleanPhone = formatPhone(customerPhone);

		if (customerId) {
			customer = await Customer.findOne({ _id: customerId, cookId: userId });
		}

		if (!customer && customerPhone) {
			customer = await Customer.findOne({
				cookId: userId,
				phoneNumber: cleanPhone,
			});
		}

		if (!customer) {
			customer = await Customer.create({
				cookId: userId,
				fullName: customerName,
				phoneNumber: cleanPhone,
				isActive: true,
			});
		}

		const deliveryFeeAmount = deliveryFee || 0;
		const { serviceFee, paystackFee, totalAmount } = calculateOrderTotals(
			amount,
			deliveryFeeAmount,
			addFeesToCustomer,
		);

		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();

		const order = await Order.create({
			cookId: userId,
			customerId: customer._id,
			customerName: customer.fullName,
			customerPhone: cleanPhone,
			orderType: "custom_order",
			customOrderTitle: title,
			customOrderDescription: description,
			deliveryType: deliveryType || "pickup",
			deliveryFee: deliveryFeeAmount,
			readyDate: new Date(readyDate),
			readyTime: readyTime || "12:00",
			pickupWindow: pickupWindow || cook.pickupWindow,
			subtotal: amount,
			serviceFee: serviceFee,
			paystackFee: paystackFee,
			totalAmount: totalAmount,
			feesAddedToCustomer: addFeesToCustomer,
			paymentMethod: "paystack",
			paymentStatus: "pending",
			paymentReference,
			status: "pending",
			customerNote: customerNote || "",
		});

		// Update customer stats
		await Customer.findByIdAndUpdate(customer._id, {
			$inc: { ordersCount: 1, totalSpent: totalAmount },
			$set: { lastOrderDate: new Date() },
		});

		// Initialize Paystack payment
		const paystackResponse = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email: customer.email || `${cleanPhone}@getameal.com`,
				amount: Math.round(totalAmount * 100),
				reference: paymentReference,
				callback_url: `${process.env.API_URL}/payment/callback`,
				metadata: {
					orderId: order._id.toString(),
					cookId: userId.toString(),
					customerName: customer.fullName,
					customerPhone: cleanPhone,
				},
			},
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		order.paymentLink = paystackResponse.data.data.authorization_url;
		await order.save();

		const receiptUrl = `https://getameal-web.vercel.app/receipt/${order._id}?phone=${cleanPhone}`;

		const encodedPaystackLink = encodeURIComponent(order.paymentLink);
		const formattedPaymentLink = `https://getameal-web.vercel.app/pay/${order._id}?kitchen=${cook.storeHandle}&link=${encodedPaystackLink}&phone=${cleanPhone}`;

		// In createCustomOrder - use valid types
		try {
			await sendNotification(
				customer._id,
				"Custom Order Created",
				`Your custom order has been created by ${cook.storeName}. Please check your payment link.`,
				"order", // ✅ Use "order" instead of "custom_order_created"
				{ orderId: order._id },
			);
		} catch (notifError) {
			console.error(
				"Failed to create customer notification:",
				notifError.message,
			);
		}

		// ✅ Use notification service for admin
		try {
			await createAdminNotification({
				type: "custom_order_created",
				message: `New custom order created by ${cook.storeName} for ${customer.fullName}`,
				orderId: order._id,
				cookId: userId,
				customerId: customer._id,
			});
		} catch (adminError) {
			console.error("Failed to create admin notification:", adminError.message);
		}

		// Send WhatsApp to customer
		const whatsappMessage = `Hi ${customer.fullName}!

Your custom order has been created by ${cook.storeName}.

Order Details:
- Order: ${title}
- Food Amount: ₦${amount.toFixed(2)}
${deliveryFeeAmount > 0 ? `- Delivery Fee: ₦${deliveryFeeAmount.toFixed(2)}` : ""}
- Total: ₦${totalAmount.toFixed(2)}
- Ready: ${new Date(readyDate).toLocaleDateString()}
- Time: ${readyTime || "12:00"}

Pay here: ${formattedPaymentLink}

View your receipt: ${receiptUrl}

Thank you for choosing ${cook.storeName}!`;

		const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(whatsappMessage)}`;

		res.status(201).json({
			success: true,
			message: "Custom order created successfully",
			order: {
				id: order._id,
				title: order.customOrderTitle,
				customerName: order.customerName,
				customerPhone: order.customerPhone,
				subtotal: order.subtotal,
				deliveryFee: order.deliveryFee,
				serviceFee: order.serviceFee,
				paystackFee: order.paystackFee,
				totalAmount: order.totalAmount,
				feesAddedToCustomer: order.feesAddedToCustomer,
				status: order.status,
				paymentLink: formattedPaymentLink,
				rawPaymentLink: order.paymentLink,
				receiptUrl: receiptUrl,
				readyDate: order.readyDate,
				deliveryType: order.deliveryType,
				whatsappUrl: whatsappUrl,
			},
		});
	} catch (error) {
		console.error("Create custom order error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// CREATE ORDER FROM CART - FIXED with notification service
// ============================================
export const createOrderFromCart = async (req, res) => {
	try {
		const {
			sessionId,
			customerName,
			customerPhone,
			customerEmail,
			customerNote,
			deliveryType,
			deliveryAddress,
			readyDate,
		} = req.body;

		if (
			!sessionId ||
			!customerName ||
			!customerPhone ||
			!deliveryType ||
			!readyDate
		) {
			return res.status(400).json({
				message:
					"Session ID, customer name, phone, delivery type, and ready date are required",
			});
		}

		const cleanPhone = formatPhone(customerPhone);
		const phoneRegex = /^[0-9]{11}$/;
		if (!phoneRegex.test(cleanPhone)) {
			return res.status(400).json({
				message: "Please enter a valid 11-digit phone number",
			});
		}

		const cart = await Cart.findOne({ sessionId });
		if (!cart || cart.items.length === 0) {
			return res.status(400).json({ message: "Cart is empty" });
		}

		const firstProduct = await Meal.findById(cart.items[0].productId);
		if (!firstProduct) {
			return res.status(404).json({ message: "Product not found" });
		}
		const cookId = firstProduct.cookId;

		const cook = await CookProfile.findOne({ userId: cookId });
		if (!cook) {
			return res.status(404).json({ message: "Cook not found" });
		}
		if (!cook.isAvailable) {
			return res.status(400).json({ message: "Store is currently paused" });
		}
		if (!cook.isApproved) {
			return res.status(400).json({ message: "Store is pending approval" });
		}

		const addFeesToCustomer = cook.fees?.addFeesToCustomer !== false;

		const readyDateTime = new Date(readyDate);
		if (readyDateTime < new Date()) {
			return res
				.status(400)
				.json({ message: "Ready date must be in the future" });
		}

		if (deliveryType === "delivery" && !deliveryAddress) {
			return res.status(400).json({
				message: "Delivery address is required for delivery orders",
			});
		}

		let customer = await Customer.findOne({
			cookId,
			phoneNumber: cleanPhone,
		});

		if (!customer) {
			customer = await Customer.create({
				cookId,
				fullName: customerName,
				phoneNumber: cleanPhone,
				email: customerEmail || "",
				isActive: true,
			});
		}

		// Build order items from cart
		const orderItems = [];
		let foodSubtotal = 0;

		for (const cartItem of cart.items) {
			const product = await Meal.findById(cartItem.productId);
			if (!product) {
				return res.status(404).json({
					message: `Product not found: ${cartItem.productId}`,
				});
			}

			if (!product.isAvailable) {
				return res.status(400).json({
					message: `${product.name} is currently unavailable`,
				});
			}

			const itemPrice = product.price;
			let itemSubtotal = itemPrice * cartItem.quantity;

			const addOns = [];
			let addOnTotal = 0;

			if (cartItem.addOns && cartItem.addOns.length) {
				for (const addOn of cartItem.addOns) {
					let productAddOn = product.addOns.find(
						(a) => a.name.toLowerCase() === addOn.name.toLowerCase(),
					);

					if (productAddOn) {
						const addOnPrice = productAddOn.price;
						const addOnSubtotal = addOnPrice * cartItem.quantity;
						addOnTotal += addOnSubtotal;
						addOns.push({
							name: productAddOn.name,
							price: addOnPrice,
						});
					} else if (addOn.name && addOn.price) {
						const addOnSubtotal = addOn.price * cartItem.quantity;
						addOnTotal += addOnSubtotal;
						addOns.push({
							name: addOn.name,
							price: addOn.price,
						});
					}
				}
			}

			const totalItemSubtotal = itemSubtotal + addOnTotal;
			foodSubtotal += totalItemSubtotal;

			orderItems.push({
				productId: product._id,
				name: product.name,
				quantity: cartItem.quantity,
				price: itemPrice,
				addOns,
				subtotal: totalItemSubtotal,
			});
		}

		const deliveryFee = deliveryType === "delivery" ? cook.deliveryFee || 0 : 0;
		const { serviceFee, paystackFee, totalAmount } = calculateOrderTotals(
			foodSubtotal,
			deliveryFee,
			addFeesToCustomer,
		);

		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();

		// Create the order
		const order = await Order.create({
			cookId,
			customerId: customer._id,
			customerName,
			customerPhone: cleanPhone,
			customerEmail: customerEmail || "",
			customerNote: customerNote || "",
			deliveryType,
			deliveryAddress: deliveryType === "delivery" ? deliveryAddress : null,
			deliveryFee,
			readyDate: readyDateTime,
			readyTime: "12:00",
			status: "pending",
			paymentStatus: "pending",
			orderType: "product_order",
			items: orderItems,
			subtotal: Math.round(foodSubtotal * 100) / 100,
			serviceFee: serviceFee,
			paystackFee: paystackFee,
			totalAmount: totalAmount,
			feesAddedToCustomer: addFeesToCustomer,
			pickupWindow: {
				from: cook.pickupWindow.from,
				to: cook.pickupWindow.to,
			},
			sessionId: sessionId,
			paymentReference,
		});

		await Customer.findByIdAndUpdate(customer._id, {
			$inc: { ordersCount: 1, totalSpent: totalAmount },
			$set: { lastOrderDate: new Date() },
		});

		await Cart.findOneAndDelete({ sessionId });

		// Initialize Paystack payment
		const paystackResponse = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email: customerEmail || `${cleanPhone}@getameal.com`,
				amount: Math.round(totalAmount * 100),
				reference: paymentReference,
				callback_url: `${process.env.API_URL}/payment/callback`,
				metadata: {
					orderId: order._id.toString(),
					cookId: cookId.toString(),
					customerName,
					customerPhone: cleanPhone,
					sessionId: sessionId,
				},
			},
			{
				headers: {
					Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
				},
			},
		);

		order.paymentLink = paystackResponse.data.data.authorization_url;
		await order.save();

		const receiptUrl = `https://getameal-web.vercel.app/receipt/${order._id}?phone=${cleanPhone}`;

		// Send push notification to cook
		try {
			await sendPushToUser(
				cookId,
				"New Order Received",
				`${customerName} placed a new order for ₦${totalAmount.toFixed(2)}`,
				{
					type: "new_order",
					orderId: order._id.toString(),
				},
			);
		} catch (pushError) {
			console.error("Failed to send push notification:", pushError.message);
		}

		// In createOrderFromCart - use valid types
		try {
			await sendNotification(
				cookId,
				"New Order Received",
				`${customerName} placed a new order for ₦${totalAmount.toFixed(2)}`,
				"order", // ✅ Use "order" instead of "new_order"
				{ orderId: order._id },
			);
		} catch (notifError) {
			console.error("Failed to create cook notification:", notifError.message);
		}

		// Create admin notification
		try {
			await createAdminNotification({
				type: "new_order",
				orderId: order._id.toString(),
				message: `${customerName} placed a new order for ₦${totalAmount.toFixed(2)}`,
			});
		} catch (adminError) {
			console.error("Failed to create admin notification:", adminError.message);
		}

		res.status(201).json({
			success: true,
			message:
				"Order created successfully. Complete payment to confirm your order.",
			order: {
				id: order._id,
				customerName: order.customerName,
				customerPhone: order.customerPhone,
				deliveryType: order.deliveryType,
				deliveryAddress: order.deliveryAddress || null,
				deliveryFee: order.deliveryFee,
				readyDate: order.readyDate,
				subtotal: order.subtotal,
				serviceFee: order.serviceFee,
				paystackFee: order.paystackFee,
				totalAmount: order.totalAmount,
				feesAddedToCustomer: order.feesAddedToCustomer,
				status: order.status,
				paymentStatus: order.paymentStatus,
				paymentLink: order.paymentLink,
				receiptUrl: receiptUrl,
				items: order.items.map((item) => ({
					name: item.name,
					quantity: item.quantity,
					price: item.price,
					addOns: item.addOns,
					subtotal: item.subtotal,
				})),
			},
		});
	} catch (error) {
		console.error("Create order from cart error:", error);
		res.status(500).json({
			message: "Failed to create order",
			error: error.message,
		});
	}
};

// ============================================
// GET ORDER REQUESTS (Payment Sessions)
// ============================================
export const getOrderRequests = async (req, res) => {
	try {
		const userId = req.user._id;
		const { status } = req.query;

		const query = {
			cookId: userId,
			sessionType: "customer_order",
		};

		if (status) {
			query.status = status;
		}

		const sessions = await PaymentSession.find(query)
			.populate("customerId", "fullName phoneNumber email")
			.sort({ createdAt: -1 });

		res.json({
			success: true,
			orders: sessions,
			count: sessions.length,
		});
	} catch (error) {
		console.error("Get order requests error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// GET COOK ORDERS
// ============================================
export const getCookOrders = async (req, res) => {
	try {
		const userId = req.user._id;
		const { status, limit = 20, page = 1 } = req.query;

		const query = { cookId: userId };
		if (status) query.status = status;

		const orders = await Order.find(query)
			.sort({ createdAt: -1 })
			.skip((page - 1) * limit)
			.limit(parseInt(limit))
			.populate("customerId", "fullName phoneNumber")
			.populate("items.productId", "name images");

		const total = await Order.countDocuments(query);

		res.json({
			success: true,
			orders,
			pagination: {
				page: parseInt(page),
				limit: parseInt(limit),
				total,
				pages: Math.ceil(total / limit),
			},
		});
	} catch (error) {
		console.error("Get cook orders error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// GET ORDER DETAILS
// ============================================
export const getOrderDetails = async (req, res) => {
	try {
		const userId = req.user._id;
		const { orderId } = req.params;

		const order = await Order.findOne({
			_id: orderId,
			cookId: userId,
		})
			.populate("customerId", "fullName phoneNumber email")
			.populate("items.productId", "name images description");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		res.json({
			success: true,
			order,
		});
	} catch (error) {
		console.error("Get order details error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// UPDATE ORDER STATUS - FIXED WALLET CREDIT
// ============================================
export const updateOrderStatus = async (req, res) => {
	try {
		const userId = req.user._id;
		const { orderId } = req.params;
		const { status, sellerNote } = req.body;

		if (!status) {
			return res.status(400).json({ message: "Status is required" });
		}

		const validStatuses = [
			"pending",
			"confirmed",
			"delivered",
			"picked_up",
			"completed",
			"cancelled",
		];

		if (!validStatuses.includes(status)) {
			return res.status(400).json({
				message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
				received: status,
			});
		}

		const order = await Order.findOne({
			_id: orderId,
			cookId: userId,
		});

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		if (
			(status === "delivered" ||
				status === "picked_up" ||
				status === "completed") &&
			order.paymentStatus !== "paid"
		) {
			return res.status(400).json({
				message: "Cannot complete order. Payment has not been confirmed.",
				paymentStatus: order.paymentStatus,
			});
		}

		const allowedTransitions = {
			pending: ["confirmed", "cancelled"],
			confirmed: ["delivered", "picked_up", "completed", "cancelled"],
			delivered: [],
			picked_up: [],
			completed: [],
			cancelled: [],
		};

		const allowedNext = allowedTransitions[order.status] || [];
		const isSameStatus = order.status === status;
		const isAllowedTransition = allowedNext.includes(status);

		if (!isAllowedTransition && !isSameStatus && allowedNext.length > 0) {
			return res.status(400).json({
				message: `Cannot transition from '${order.status}' to '${status}'`,
				allowed: allowedNext,
			});
		}

		if (
			(status === "delivered" || status === "completed") &&
			order.deliveryType !== "delivery"
		) {
			return res.status(400).json({
				message: `${status} is only for delivery orders`,
				suggestion: "Use 'picked_up' for pickup orders",
			});
		}

		if (status === "picked_up" && order.deliveryType !== "pickup") {
			return res.status(400).json({
				message: "picked_up is only for pickup orders",
				suggestion: "Use 'delivered' or 'completed' for delivery orders",
			});
		}

		const oldStatus = order.status;
		let walletCredited = false;
		let walletAmount = 0;

		const isCompletingOrder =
			(status === "delivered" ||
				status === "picked_up" ||
				status === "completed") &&
			order.paymentStatus === "paid";

		const isAlreadyCompleted =
			(order.status === "delivered" ||
				order.status === "picked_up" ||
				order.status === "completed") &&
			order.paymentStatus === "paid";

		// ✅ CREDIT WALLET when completing an order
		if (isCompletingOrder || (isAlreadyCompleted && !isSameStatus)) {
			try {
				// ✅ Check if already credited
				const existingTransaction = await WalletTransaction.findOne({
					reference: order._id.toString(),
					type: "credit",
				});

				if (existingTransaction) {
					console.log(`Order ${order._id} already credited`);
					walletCredited = true;
					walletAmount = existingTransaction.amount || 0;

					// Still update order status
					if (oldStatus !== status) {
						order.status = status;
					}
					if (sellerNote) order.sellerNote = sellerNote;
					await order.save();

					const cook = await User.findById(order.cookId);
					const currentBalance = cook?.walletBalance || 0;
					const updatedOrder = await Order.findById(order._id)
						.populate("customerId", "fullName phoneNumber email")
						.populate("items.productId", "name images");

					return res.json({
						success: true,
						message: `Order status updated from '${oldStatus}' to '${status}'`,
						order: updatedOrder,
						transition: { from: oldStatus, to: status },
						wallet: {
							credited: true,
							amount: walletAmount,
							newBalance: currentBalance,
							message: `Already credited ₦${walletAmount.toFixed(2)}. New balance: ₦${currentBalance.toFixed(2)}`,
						},
					});
				}

				// ✅ Calculate cook's earnings
				const feesAddedToCustomer = order.feesAddedToCustomer !== false;
				let cookAmount = 0;
				let platformFee = 0;

				if (feesAddedToCustomer) {
					const platformFeeRate = 0.05;
					platformFee = order.totalAmount * platformFeeRate;
					cookAmount =
						Math.round((order.totalAmount - platformFee) * 100) / 100;
				} else {
					const platformFeeRate = 0.05;
					platformFee = order.subtotal * platformFeeRate;
					const paystackFee = order.paystackFee || 0;
					cookAmount =
						Math.round((order.totalAmount - platformFee - paystackFee) * 100) /
						100;
				}

				if (cookAmount < 0) cookAmount = 0;

				console.log(
					`💰 Crediting wallet: ₦${cookAmount.toFixed(2)} for order ${order._id}`,
				);

				// ✅ UPDATE COOK PROFILE WALLET - Using findOneAndUpdate for reliability
				const updatedCookProfile = await CookProfile.findOneAndUpdate(
					{ userId: order.cookId },
					{
						$inc: {
							walletBalance: cookAmount,
							ordersCount: 1,
						},
					},
					{
						new: true,
						upsert: false,
					},
				);

				if (updatedCookProfile) {
					console.log(
						`✅ Cook wallet updated: ₦${updatedCookProfile.walletBalance}`,
					);
					walletCredited = true;
					walletAmount = cookAmount;
				} else {
					console.error(`❌ Failed to update wallet for cook ${order.cookId}`);
				}

				// ✅ Create wallet transaction
				if (walletCredited) {
					try {
						await WalletTransaction.create({
							cookId: order.cookId,
							type: "credit",
							amount: cookAmount,
							reference: order._id.toString(),
							description: `Order #${order._id.toString().slice(-6)} payment ${!feesAddedToCustomer ? "(cook absorbed fees)" : ""}`,
							status: "success",
							orderId: order._id,
						});
						console.log(`✅ Wallet transaction created for order ${order._id}`);
					} catch (txError) {
						console.error(
							"Failed to create WalletTransaction:",
							txError.message,
						);
					}
				}
			} catch (error) {
				console.error("Error crediting wallet:", error);
			}
		}

		// ✅ Update order status
		if (oldStatus !== status) {
			order.status = status;
		}
		if (sellerNote) order.sellerNote = sellerNote;
		await order.save();

		// ✅ Get updated cook balance
		const cook = await User.findById(order.cookId);
		const currentBalance = cook?.walletBalance || 0;

		const updatedOrder = await Order.findById(order._id)
			.populate("customerId", "fullName phoneNumber email")
			.populate("items.productId", "name images");

		res.json({
			success: true,
			message: `Order status updated from '${oldStatus}' to '${status}'`,
			order: updatedOrder,
			transition: {
				from: oldStatus,
				to: status,
			},
			wallet: walletCredited
				? {
						credited: true,
						amount: walletAmount,
						newBalance: currentBalance,
						message: `₦${walletAmount.toFixed(2)} credited to your wallet. New balance: ₦${currentBalance.toFixed(2)}`,
					}
				: {
						credited: false,
						currentBalance: currentBalance,
						message: "No wallet credit applied.",
					},
		});
	} catch (error) {
		console.error("Update order status error:", error);
		res.status(500).json({
			message: "Failed to update order status",
			error: error.message,
		});
	}
};
