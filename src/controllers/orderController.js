// controllers/orderController.js
import axios from "axios";
import crypto from "crypto";
import CookProfile from "../models/CookProfile.js";
import Customer from "../models/Customer.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import { sendPushToUser } from "../services/pushService.js";

// ============================================
// CUSTOMER ORDER CREATION (Public - No Auth)
// ============================================
// controllers/orderController.js - Fixed createCustomerOrder

// controllers/orderController.js - Fixed createCustomerOrder

export const createCustomerOrder = async (req, res) => {
	try {
		const {
			cookId,
			items,
			customerName,
			customerPhone,
			customerEmail,
			customerNote,
			deliveryType,
			deliveryFee,
			pickupWindow,
			readyDate,
			readyTime,
			customOrder,
		} = req.body;

		// Validate required fields
		if (!cookId || !customerName || !customerPhone || !deliveryType) {
			return res.status(400).json({
				message:
					"Cook ID, customer name, phone, and delivery type are required",
			});
		}

		// Validate phone number
		const phoneRegex = /^[0-9]{11}$/;
		if (!phoneRegex.test(customerPhone.replace(/\D/g, ""))) {
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
		if (!readyDate) {
			return res.status(400).json({ message: "Ready date is required" });
		}
		const readyDateTime = new Date(readyDate);
		if (readyDateTime < new Date()) {
			return res
				.status(400)
				.json({ message: "Ready date must be in the future" });
		}

		let orderData = {
			cookId,
			customerName,
			customerPhone: customerPhone.replace(/\D/g, ""),
			customerEmail,
			customerNote,
			deliveryType,
			deliveryFee: deliveryFee || 0,
			readyDate: readyDateTime,
			readyTime: readyTime || "12:00",
			status: "pending",
			paymentStatus: "pending",
		};

		// Check if customer exists, if not create them
		let customer = await Customer.findOne({
			cookId,
			phoneNumber: customerPhone.replace(/\D/g, ""),
		});

		if (!customer) {
			customer = await Customer.create({
				cookId,
				fullName: customerName,
				phoneNumber: customerPhone.replace(/\D/g, ""),
				email: customerEmail || "",
				isActive: true,
			});
		}

		orderData.customerId = customer._id;

		// Handle product order vs custom order
		let subtotal = 0;

		if (customOrder) {
			// Custom order
			orderData.orderType = "custom_order";
			orderData.customOrderTitle = customOrder.title;
			orderData.customOrderDescription = customOrder.description;

			const serviceFee = customOrder.amount * 0.05;
			const paystackFee = (customOrder.amount + serviceFee) * 0.015 + 1;

			orderData.subtotal = customOrder.amount;
			orderData.serviceFee = serviceFee + paystackFee;
			orderData.totalAmount =
				customOrder.amount + serviceFee + paystackFee + (deliveryFee || 0);
		} else {
			// Product order
			if (!items || !items.length) {
				return res.status(400).json({ message: "Order items are required" });
			}

			orderData.orderType = "product_order";
			orderData.items = [];

			for (const item of items) {
				const product = await Meal.findById(item.productId);
				if (!product) {
					return res.status(404).json({
						message: `Product not found: ${item.productId}`,
					});
				}

				if (!product.isAvailable) {
					return res.status(400).json({
						message: `${product.name} is currently unavailable`,
					});
				}

				// Use customerPrice (what customer actually pays)
				const itemPrice = product.customerPrice || product.price;
				let itemSubtotal = itemPrice * item.quantity;

				// Process add-ons
				const addOns = [];
				if (item.addOns && item.addOns.length) {
					for (const addOn of item.addOns) {
						// ✅ MATCH BY NAME (most reliable since customer knows the add-on name)
						let productAddOn = null;

						// Try to find by name (case insensitive)
						if (addOn.name) {
							productAddOn = product.addOns.find(
								(a) => a.name.toLowerCase() === addOn.name.toLowerCase(),
							);
						}

						// If not found by name, try by id
						if (!productAddOn && addOn.id) {
							productAddOn = product.addOns.find(
								(a) => a._id && a._id.toString() === addOn.id,
							);
						}

						if (productAddOn) {
							// Use the product's actual add-on price
							const addOnPrice = productAddOn.price;
							const addOnTotal = addOnPrice * item.quantity;
							itemSubtotal += addOnTotal;

							addOns.push({
								name: productAddOn.name,
								price: addOnPrice,
							});
						} else {
							// If add-on not found in product, use the provided values
							console.warn(
								`Add-on not found in product: ${addOn.name || addOn.id}`,
							);
							if (addOn.name && addOn.price) {
								const addOnTotal = addOn.price * item.quantity;
								itemSubtotal += addOnTotal;
								addOns.push({
									name: addOn.name,
									price: addOn.price,
								});
							}
						}
					}
				}

				subtotal += itemSubtotal;

				orderData.items.push({
					productId: product._id,
					name: product.name,
					quantity: item.quantity,
					price: itemPrice,
					addOns,
					subtotal: itemSubtotal,
				});
			}

			// Calculate fees
			const serviceFee = subtotal * 0.05;
			const paystackFee = (subtotal + serviceFee) * 0.015 + 1;

			orderData.subtotal = subtotal;
			orderData.serviceFee = serviceFee + paystackFee;
			orderData.totalAmount =
				subtotal + serviceFee + paystackFee + (deliveryFee || 0);
		}

		// Set pickup window
		if (pickupWindow) {
			orderData.pickupWindow = pickupWindow;
		} else {
			orderData.pickupWindow = {
				from: cook.pickupWindow.from,
				to: cook.pickupWindow.to,
			};
		}

		// Create the order
		const order = await Order.create(orderData);

		// Update customer stats
		await Customer.findByIdAndUpdate(customer._id, {
			$inc: { ordersCount: 1, totalSpent: orderData.totalAmount },
			$set: { lastOrderDate: new Date() },
		});

		// Generate payment link
		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();
		order.paymentReference = paymentReference;

		// Initialize Paystack payment
		const paystackResponse = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email: customerEmail || `${customerPhone}@getameal.com`,
				amount: Math.round(orderData.totalAmount * 100),
				reference: paymentReference,
				callback_url: `${process.env.API_URL}/customer/payment/callback`,
				metadata: {
					orderId: order._id.toString(),
					cookId: cookId.toString(),
					customerName,
					customerPhone: customerPhone.replace(/\D/g, ""),
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

		// Send push notification to cook
		await sendPushToUser(
			cookId,
			"New Order Received 🆕",
			`${customerName} placed a new order for ₦${orderData.totalAmount.toFixed(2)}`,
			{
				type: "new_order",
				orderId: order._id.toString(),
			},
		);

		res.status(201).json({
			success: true,
			message: "Order created successfully",
			order: {
				id: order._id,
				customerName: order.customerName,
				totalAmount: order.totalAmount,
				status: order.status,
				paymentStatus: order.paymentStatus,
				paymentLink: order.paymentLink,
				readyDate: order.readyDate,
				deliveryType: order.deliveryType,
			},
		});
	} catch (error) {
		console.error("Create customer order error:", error);
		res.status(500).json({
			message: "Failed to create order",
			error: error.message,
		});
	}
};

// ============================================
// GET CUSTOMER ORDER DETAILS (Public)
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
			customerPhone: phone.replace(/\D/g, ""),
		})
			.populate("cookId", "fullName email phone")
			.populate("items.productId", "name images");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		const cookProfile = await CookProfile.findOne({ userId: order.cookId });

		res.json({
			success: true,
			order: {
				id: order._id,
				items: order.items,
				customOrderTitle: order.customOrderTitle,
				customOrderDescription: order.customOrderDescription,
				totalAmount: order.totalAmount,
				status: order.status,
				paymentStatus: order.paymentStatus,
				deliveryType: order.deliveryType,
				readyDate: order.readyDate,
				readyTime: order.readyTime,
				pickupWindow: order.pickupWindow,
				deliveryFee: order.deliveryFee,
				createdAt: order.createdAt,
				customerNote: order.customerNote,
				sellerNote: order.sellerNote,
				cook: {
					id: order.cookId._id,
					fullName: order.cookId.fullName,
					email: order.cookId.email,
					phone: order.cookId.phone,
					storeName: cookProfile?.storeName,
					storeHandle: cookProfile?.storeHandle,
					storeLink: cookProfile?.storeLink,
					profileImage: cookProfile?.profileImage,
					kitchenAddress: cookProfile?.kitchenAddress,
					pickupLandmark: cookProfile?.pickupLandmark,
					pickupWindow: cookProfile?.pickupWindow,
				},
			},
		});
	} catch (error) {
		console.error("Get customer order details error:", error);
		res.status(500).json({ message: error.message });
	}
};

// ============================================
// PAYMENT REDIRECT
// ============================================
export const paymentRedirect = async (req, res) => {
	try {
		const { orderId, reference, status } = req.query;
		const redirectUrl = `getameal://payment-status?orderId=${orderId}&reference=${reference}&status=${status || "success"}`;
		return res.redirect(redirectUrl);
	} catch (error) {
		console.error("Redirect error:", error);
		res.status(500).send("Redirect failed");
	}
};

export const handlePaymentCallback = async (req, res) => {
	try {
		const method = req.method;

		console.log("📥 Payment callback received:", {
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

		console.log(`🔍 Verifying payment for reference: ${reference}`);

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

		console.log(`📊 Payment data:`, {
			status: paymentData.status,
			amount: paymentData.amount,
			reference: paymentData.reference,
			metadata: paymentData.metadata,
		});

		if (paymentData.status !== "success") {
			return res.status(400).json({ message: "Payment not successful" });
		}

		const metaOrderId = paymentData.metadata?.orderId;

		if (!metaOrderId) {
			console.error("Order ID not found in metadata:", paymentData.metadata);
			return res.status(400).json({
				message: "Order ID not found in payment metadata",
				metadata: paymentData.metadata,
			});
		}

		const order = await Order.findById(metaOrderId)
			.populate("items.productId")
			.populate("cookId")
			.populate("customerId");

		if (!order) {
			console.error(`Order not found: ${metaOrderId}`);
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
				`getameal://payment-status?orderId=${order._id}&status=success&message=Already+processed`,
			);
		}

		// ✅ FIX: Round both amounts to 2 decimal places for comparison
		const paidAmount = Math.round((paymentData.amount / 100) * 100) / 100;
		const expectedAmount = Math.round(order.totalAmount * 100) / 100;

		console.log(
			`💰 Amount comparison: Expected ${expectedAmount}, Paid ${paidAmount}`,
		);

		// ✅ Compare with tolerance (0.01 naira tolerance)
		const difference = Math.abs(paidAmount - expectedAmount);
		if (difference > 0.01) {
			console.error(
				`Amount mismatch: Expected ${expectedAmount}, Paid ${paidAmount}, Difference: ${difference}`,
			);

			if (method === "POST") {
				return res.status(400).json({
					message: "Amount mismatch",
					expected: expectedAmount,
					paid: paidAmount,
					difference: difference,
				});
			}

			return res.redirect(
				`getameal://payment-status?orderId=${order._id}&status=failed&message=Amount+mismatch`,
			);
		}

		// ✅ Update order with rounded amount
		order.paymentStatus = "paid";
		order.status = "confirmed";
		order.paymentReference = reference;
		await order.save();

		console.log(
			`✅ Order ${order._id} updated: paymentStatus=paid, status=confirmed`,
		);

		// Send push notification to cook
		try {
			await sendPushToUser(
				order.cookId._id,
				"🆕 New Paid Order! 💰",
				`${order.customerName} placed an order for ₦${order.totalAmount.toFixed(2)}`,
				{
					type: "new_paid_order",
					orderId: order._id.toString(),
					amount: order.totalAmount.toFixed(2),
				},
			);
			console.log(`📱 Push notification sent to cook: ${order.cookId._id}`);
		} catch (pushError) {
			console.error("Push notification error:", pushError.message);
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
			`getameal://payment-status?orderId=${order._id}&status=success&message=Payment+verified`,
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
			`getameal://payment-status?status=failed&message=${encodeURIComponent(error.message)}`,
		);
	}
};

// ============================================
// COOK ORDER MANAGEMENT (Authenticated)
// ============================================

// Get all orders for cook
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

// Get order details
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

// Update order status
// controllers/orderController.js - Updated updateOrderStatus with transitions

// controllers/orderController.js - Fixed updateOrderStatus

export const updateOrderStatus = async (req, res) => {
	try {
		const userId = req.user._id;
		const { orderId } = req.params;
		const { status, sellerNote } = req.body;

		if (!status) {
			return res.status(400).json({ message: "Status is required" });
		}

		const order = await Order.findOne({
			_id: orderId,
			cookId: userId,
		});

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		// ✅ Valid statuses - must match model enum exactly
		const validStatuses = [
			"pending",
			"confirmed",
			"preparing",
			"ready",
			"out_for_delivery",
			"picked_up",
			"delivered",
			"cancelled",
		];

		// ✅ Check if status is valid
		if (!validStatuses.includes(status)) {
			return res.status(400).json({
				message: `Invalid status. Allowed values: ${validStatuses.join(", ")}`,
				received: status,
			});
		}

		// ✅ Check if status is already set
		if (order.status === status) {
			return res.status(400).json({
				message: `Order is already in '${status}' status`,
			});
		}

		// ✅ Define allowed transitions
		const allowedTransitions = {
			pending: ["confirmed", "cancelled"],
			confirmed: ["preparing", "cancelled"],
			preparing: ["ready", "cancelled"],
			ready: ["out_for_delivery", "picked_up", "cancelled"],
			out_for_delivery: ["delivered", "cancelled"],
			picked_up: [],
			delivered: [],
			cancelled: [],
		};

		// ✅ Check if transition is allowed
		const allowedNext = allowedTransitions[order.status] || [];
		if (!allowedNext.includes(status) && allowedNext.length > 0) {
			return res.status(400).json({
				message: `Cannot transition from '${order.status}' to '${status}'. Allowed: ${allowedNext.join(", ")}`,
				currentStatus: order.status,
				requestedStatus: status,
				allowedTransitions: allowedNext,
			});
		}

		// ✅ Special validation for out_for_delivery
		if (status === "out_for_delivery" && order.deliveryType !== "delivery") {
			return res.status(400).json({
				message:
					"Cannot set 'out_for_delivery' for pickup orders. Use 'ready' then 'picked_up'.",
				deliveryType: order.deliveryType,
				suggestion: "For pickup orders: ready → picked_up",
			});
		}

		// ✅ Special validation for picked_up
		if (status === "picked_up" && order.deliveryType !== "pickup") {
			return res.status(400).json({
				message:
					"Cannot set 'picked_up' for delivery orders. Use 'out_for_delivery' then 'delivered'.",
				deliveryType: order.deliveryType,
				suggestion: "For delivery orders: ready → out_for_delivery → delivered",
			});
		}

		// ✅ Special validation for delivered
		if (status === "delivered" && order.deliveryType !== "delivery") {
			return res.status(400).json({
				message:
					"Cannot set 'delivered' for pickup orders. Use 'picked_up' instead.",
				deliveryType: order.deliveryType,
				suggestion: "For pickup orders: ready → picked_up",
			});
		}

		const oldStatus = order.status;
		order.status = status;
		if (sellerNote) order.sellerNote = sellerNote;

		await order.save();

		// Send push notification (optional)
		try {
			// You can implement push notification here
			console.log(`📱 Order ${order._id} status updated to ${status}`);
		} catch (pushError) {
			console.error("Push notification error:", pushError.message);
		}

		// ✅ Return updated order
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
		});
	} catch (error) {
		console.error("Update order status error:", error);
		res.status(500).json({
			message: "Failed to update order status",
			error: error.message,
		});
	}
};

export const getOrderRequests = async (req, res) => {
	try {
		const userId = req.user._id;
		const { status } = req.query;

		// Build query
		const query = {
			cookId: userId,
			orderType: "custom_order",
		};

		// Only filter by status if provided, otherwise get all custom orders
		if (status) {
			query.status = status;
		}

		const orders = await Order.find(query)
			.populate("customerId", "fullName phoneNumber email")
			.sort({ createdAt: -1 });

		res.json({
			success: true,
			orders,
			count: orders.length,
		});
	} catch (error) {
		console.error("Get order requests error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Accept order request
export const acceptOrderRequest = async (req, res) => {
	try {
		const userId = req.user._id;
		const { requestId } = req.params;

		const order = await Order.findOne({
			_id: requestId,
			cookId: userId,
			status: "pending",
		});

		if (!order) {
			return res.status(404).json({ message: "Order request not found" });
		}

		order.status = "confirmed";
		await order.save();

		await sendPushToUser(
			userId,
			"Order Request Accepted ✅",
			`You accepted a custom order from ${order.customerName}`,
			{
				type: "order_accepted",
				orderId: order._id.toString(),
			},
		);

		res.json({
			success: true,
			message: "Order request accepted",
			order,
		});
	} catch (error) {
		console.error("Accept order request error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Decline order request
export const declineOrderRequest = async (req, res) => {
	try {
		const userId = req.user._id;
		const { requestId } = req.params;
		const { reason } = req.body;

		const order = await Order.findOne({
			_id: requestId,
			cookId: userId,
			status: "pending",
		});

		if (!order) {
			return res.status(404).json({ message: "Order request not found" });
		}

		order.status = "cancelled";
		order.sellerNote = reason || "Order request declined";
		await order.save();

		await sendPushToUser(
			userId,
			"Order Request Declined ❌",
			`You declined a custom order from ${order.customerName}`,
			{
				type: "order_declined",
				orderId: order._id.toString(),
			},
		);

		res.json({
			success: true,
			message: "Order request declined",
			order,
		});
	} catch (error) {
		console.error("Decline order request error:", error);
		res.status(500).json({ message: error.message });
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

		// Find or create customer
		let customer = null;
		if (customerId) {
			customer = await Customer.findOne({ _id: customerId, cookId: userId });
		}

		if (!customer && customerPhone) {
			customer = await Customer.findOne({
				cookId: userId,
				phoneNumber: customerPhone.replace(/\D/g, ""),
			});
		}

		if (!customer) {
			customer = await Customer.create({
				cookId: userId,
				fullName: customerName,
				phoneNumber: customerPhone.replace(/\D/g, ""),
				isActive: true,
			});
		}

		// Calculate fees
		const serviceFee = amount * 0.05;
		const paystackFee = (amount + serviceFee) * 0.015 + 1;
		const totalAmount = amount + serviceFee + paystackFee + (deliveryFee || 0);

		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();

		// ✅ FIX: Set status to "pending" so it shows in order requests
		const order = await Order.create({
			cookId: userId,
			customerId: customer._id,
			customerName: customer.fullName,
			customerPhone: customer.phoneNumber,
			orderType: "custom_order",
			customOrderTitle: title,
			customOrderDescription: description,
			deliveryType: deliveryType || "pickup",
			deliveryFee: deliveryFee || 0,
			readyDate: new Date(readyDate),
			readyTime: readyTime || "12:00",
			pickupWindow: pickupWindow || cook.pickupWindow,
			subtotal: amount,
			serviceFee: serviceFee + paystackFee,
			totalAmount,
			paymentMethod: "paystack",
			paymentStatus: "pending",
			paymentReference,
			status: "pending", // ✅ Changed from "confirmed" to "pending"
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
				email: customer.email || `${customer.phoneNumber}@getameal.com`,
				amount: Math.round(totalAmount * 100),
				reference: paymentReference,
				callback_url: `${process.env.API_URL}/customer/payment/callback`,
				metadata: {
					orderId: order._id.toString(),
					cookId: userId.toString(),
					customerName: customer.fullName,
					customerPhone: customer.phoneNumber,
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

		await sendPushToUser(
			userId,
			"Custom Order Created 📝",
			`Custom order "${title}" created for ${customer.fullName}`,
			{
				type: "custom_order_created",
				orderId: order._id.toString(),
			},
		);

		res.status(201).json({
			success: true,
			message: "Custom order created successfully",
			order: {
				id: order._id,
				title: order.customOrderTitle,
				customerName: order.customerName,
				totalAmount: order.totalAmount,
				status: order.status,
				paymentLink: order.paymentLink,
				readyDate: order.readyDate,
				deliveryType: order.deliveryType,
			},
		});
	} catch (error) {
		console.error("Create custom order error:", error);
		res.status(500).json({ message: error.message });
	}
};
