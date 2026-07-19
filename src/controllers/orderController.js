// controllers/orderController.js
import axios from "axios";
import crypto from "crypto";
import Cart from "../models/Cart.js";
import CookProfile from "../models/CookProfile.js";
import Customer from "../models/Customer.js";
import Meal from "../models/Meal.js";
import Order from "../models/Order.js";
import User from "../models/User.js";
import WalletTransaction from "../models/WalletTransaction.js";
import { sendPushToUser } from "../services/pushService.js";

// ============================================
// CUSTOMER ORDER CREATION (Public - No Auth)
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
				isActive: true,
			});
		}

		// Create order data
		const orderData = {
			cookId,
			customerId: customer._id,
			customerName,
			customerPhone: customerPhone.replace(/\D/g, ""),
			customerNote: customerNote || "",
			deliveryType,
			deliveryAddress: deliveryType === "delivery" ? deliveryAddress : null,
			deliveryFee: deliveryType === "delivery" ? cook.deliveryFee || 0 : 0,
			readyDate: readyDateTime,
			readyTime: "12:00",
			status: "pending",
			paymentStatus: "pending",
			orderType: "custom_order",
			customOrderTitle: foodRequest, // What the customer wants
			customOrderDescription: customerNote || "",
			// Amount will be set by the cook when they accept
			subtotal: 0,
			serviceFee: 0,
			totalAmount: 0,
			pickupWindow: {
				from: cook.pickupWindow.from,
				to: cook.pickupWindow.to,
			},
		};

		// Create the order
		const order = await Order.create(orderData);

		// Update customer stats
		await Customer.findByIdAndUpdate(customer._id, {
			$inc: { ordersCount: 1 },
			$set: { lastOrderDate: new Date() },
		});

		// Send push notification to cook
		await sendPushToUser(
			cookId,
			"New Food Request 🍽️",
			`${customerName} wants: ${foodRequest}`,
			{
				type: "new_order_request",
				orderId: order._id.toString(),
				customerName,
				foodRequest,
			},
		);

		res.status(201).json({
			success: true,
			message: "Food request sent to cook successfully",
			order: {
				id: order._id,
				customerName: order.customerName,
				customerPhone: order.customerPhone,
				foodRequest: order.customOrderTitle,
				deliveryType: order.deliveryType,
				deliveryAddress: order.deliveryAddress || null,
				readyDate: order.readyDate,
				status: order.status,
				paymentStatus: order.paymentStatus,
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
// controllers/orderController.js - Updated getCustomerOrderDetails

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
			.populate("cookId", "fullName email phone profileImage")
			.populate("customerId", "fullName phoneNumber email")
			.populate("items.productId", "name images description");

		if (!order) {
			return res.status(404).json({ message: "Order not found" });
		}

		const cookProfile = await CookProfile.findOne({ userId: order.cookId });

		res.json({
			success: true,
			order: {
				id: order._id,

				// ✅ Customer Details
				customer: {
					id: order.customerId?._id || null,
					fullName: order.customerName,
					phone: order.customerPhone,
					email: order.customerEmail || null,
					note: order.customerNote || null,
				},

				// ✅ Order Items
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

				// ✅ Custom Order Details
				customOrderTitle: order.customOrderTitle || null,
				customOrderDescription: order.customOrderDescription || null,

				// ✅ Delivery Details
				deliveryType: order.deliveryType,
				deliveryAddress: order.deliveryAddress || null,
				deliveryFee: order.deliveryFee || 0,
				pickupWindow: order.pickupWindow || null,

				// ✅ Timing
				readyDate: order.readyDate,
				readyTime: order.readyTime || "12:00",
				createdAt: order.createdAt,

				// ✅ Financials
				subtotal: order.subtotal,
				serviceFee: order.serviceFee,
				totalAmount: order.totalAmount,

				// ✅ Status
				status: order.status,
				paymentStatus: order.paymentStatus,

				// ✅ Notes
				customerNote: order.customerNote || null,
				sellerNote: order.sellerNote || null,

				// ✅ Cook Details
				cook: {
					id: order.cookId._id,
					fullName: order.cookId.fullName,
					email: order.cookId.email,
					phone: order.cookId.phone,
					profileImage: order.cookId.profileImage || null,
					storeName: cookProfile?.storeName || null,
					storeHandle: cookProfile?.storeHandle || null,
					storeLink: cookProfile?.storeLink || null,
					profileImage: cookProfile?.profileImage || null,
					kitchenAddress: cookProfile?.kitchenAddress || null,
					pickupLandmark: cookProfile?.pickupLandmark || null,
					pickupWindow: cookProfile?.pickupWindow || null,
					rating: cookProfile?.rating || 0,
					reviewsCount: cookProfile?.reviewsCount || 0,
				},
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

// ============================================
// PAYMENT REDIRECT
// ============================================
export const paymentRedirect = async (req, res) => {
	try {
		const { orderId, reference, status } = req.query;
		const redirectUrl = `https://getameal-client.vercel.app/order-confirmed?orderId=${orderId}&reference=${reference}&status=${status || "success"}`;
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
				`https://getameal-client.vercel.app/order-confirmed?orderId=${order._id}&status=success&message=Already+processed`,
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
				`https://getameal-client.vercel.app/order-confirmed?orderId=${order._id}&status=failed&message=Amount+mismatch`,
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
			`https://getameal-client.vercel.app/order-confirmed?orderId=${order._id}&status=success&message=Payment+verified`,
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
			`https://getameal-client.vercel.app/order-confirmed?status=failed&message=${encodeURIComponent(error.message)}`,
		);
	}
};

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

// controllers/orderController.js - Updated updateOrderStatus with correct 5% platform fee

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
			"preparing",
			"ready",
			"out_for_delivery",
			"picked_up",
			"delivered",
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

		// ✅ Check if order is paid before allowing completion
		if (
			(status === "delivered" || status === "picked_up") &&
			order.paymentStatus !== "paid"
		) {
			return res.status(400).json({
				message: "Cannot complete order. Payment has not been confirmed.",
				paymentStatus: order.paymentStatus,
			});
		}

		// Validate transition
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

		const allowedNext = allowedTransitions[order.status] || [];
		const isSameStatus = order.status === status;
		const isAllowedTransition = allowedNext.includes(status);

		if (!isAllowedTransition && !isSameStatus && allowedNext.length > 0) {
			return res.status(400).json({
				message: `Cannot transition from '${order.status}' to '${status}'`,
				allowed: allowedNext,
			});
		}

		// Delivery type validation
		if (status === "out_for_delivery" && order.deliveryType !== "delivery") {
			return res.status(400).json({
				message: "out_for_delivery is only for delivery orders",
				suggestion: "Use 'picked_up' for pickup orders",
			});
		}

		if (status === "delivered" && order.deliveryType !== "delivery") {
			return res.status(400).json({
				message: "delivered is only for delivery orders",
				suggestion: "Use 'picked_up' for pickup orders",
			});
		}

		if (status === "picked_up" && order.deliveryType !== "pickup") {
			return res.status(400).json({
				message: "picked_up is only for pickup orders",
				suggestion:
					"Use 'out_for_delivery' then 'delivered' for delivery orders",
			});
		}

		const oldStatus = order.status;

		// ✅ CREDIT WALLET when order is delivered or picked up
		let walletCredited = false;
		let walletAmount = 0;
		let cook = null;

		const isCompletingOrder =
			(status === "delivered" || status === "picked_up") &&
			order.paymentStatus === "paid";
		const isAlreadyCompleted =
			(order.status === "delivered" || order.status === "picked_up") &&
			order.paymentStatus === "paid";

		if (isCompletingOrder || (isSameStatus && isAlreadyCompleted)) {
			try {
				// Check if already credited
				let existingTransaction = null;
				try {
					existingTransaction = await WalletTransaction.findOne({
						reference: order._id.toString(),
						type: "credit",
					});
				} catch (txError) {
					console.log(
						"WalletTransaction model might not exist yet, creating...",
					);
				}

				if (!existingTransaction) {
					// ✅ Calculate cook's earnings based on fee toggle
					const feesAddedToCustomer = order.feesAddedToCustomer !== false; // Default: true
					let cookAmount = 0;
					let platformFee = 0;
					let paystackFeeDeducted = 0;

					if (feesAddedToCustomer) {
						// ✅ Customer paid fees - deduct platform fee (5%)
						const platformFeeRate = 0.05;
						platformFee = order.totalAmount * platformFeeRate;
						cookAmount =
							Math.round((order.totalAmount - platformFee) * 100) / 100;
						paystackFeeDeducted = 0; // Customer already paid Paystack fee
					} else {
						// ✅ Cook absorbs fees - deduct platform fee (5%) + Paystack fee from cook's payout
						const platformFeeRate = 0.05;
						platformFee = order.subtotal * platformFeeRate; // 5% on food subtotal only
						const paystackFee = order.paystackFee || 0;

						// Cook's earnings = totalAmount - platformFee - paystackFee
						cookAmount =
							Math.round(
								(order.totalAmount - platformFee - paystackFee) * 100,
							) / 100;
						paystackFeeDeducted = paystackFee;
					}

					// Ensure cookAmount is not negative
					if (cookAmount < 0) cookAmount = 0;

					// Find cook user
					cook = await User.findById(order.cookId);
					if (!cook) {
						console.error(`Cook not found for order ${order._id}`);
						return res.status(404).json({ message: "Cook not found" });
					}

					// Update cook wallet
					const previousBalance = cook.walletBalance || 0;
					cook.walletBalance =
						Math.round((previousBalance + cookAmount) * 100) / 100;
					await cook.save();

					// Update CookProfile wallet
					const cookProfile = await CookProfile.findOne({
						userId: order.cookId,
					});
					if (cookProfile) {
						cookProfile.walletBalance =
							Math.round((cookProfile.walletBalance || 0 + cookAmount) * 100) /
							100;
						await cookProfile.save();
					}

					// Create wallet transaction
					try {
						await WalletTransaction.create({
							cookId: cook._id,
							type: "credit",
							amount: cookAmount,
							reference: order._id.toString(),
							description: `Order #${order._id.toString().slice(-6)} payment ${!feesAddedToCustomer ? "(cook absorbed fees)" : ""}`,
							status: "success",
						});
					} catch (txError) {
						console.error(
							"Failed to create WalletTransaction:",
							txError.message,
						);
					}

					walletCredited = true;
					walletAmount = cookAmount;

					console.log(
						`💰 Cook ${cook._id} wallet credited with ₦${cookAmount.toFixed(2)}`,
					);
					console.log(`   Total: ₦${order.totalAmount.toFixed(2)}`);
					console.log(`   Platform Fee (5%): ₦${platformFee.toFixed(2)}`);
					console.log(
						`   Paystack Fee Deducted: ₦${paystackFeeDeducted.toFixed(2)}`,
					);
					console.log(`   Fees added to customer: ${feesAddedToCustomer}`);

					// Send push notification
					try {
						await sendPushToUser(
							order.cookId,
							"💰 Payment Received!",
							`You earned ₦${cookAmount.toFixed(2)} from order #${order._id.toString().slice(-6)}`,
							{
								type: "wallet_credit",
								orderId: order._id.toString(),
								amount: cookAmount.toString(),
								newBalance: cook.walletBalance.toString(),
							},
						);
					} catch (pushError) {
						console.error("Push error:", pushError.message);
					}
				} else {
					console.log(`Order ${order._id} already credited`);
					walletCredited = true;
					walletAmount = existingTransaction?.amount || 0;

					// ✅ Fetch the cook to get current balance
					cook = await User.findById(order.cookId);
				}
			} catch (error) {
				console.error("Error crediting wallet:", error);
			}
		}

		// Update order status (only if status is different)
		if (oldStatus !== status) {
			order.status = status;
		}
		if (sellerNote) order.sellerNote = sellerNote;
		await order.save();

		// ✅ Fetch fresh cook data for accurate balance
		if (!cook) {
			cook = await User.findById(order.cookId);
		}
		const currentBalance = cook?.walletBalance || 0;

		// Get updated order with populated fields
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

export const acceptOrderRequest = async (req, res) => {
	try {
		const userId = req.user._id;
		const { requestId } = req.params;
		const { amount } = req.body;

		// Amount is required - cook sets the price for food
		if (!amount || amount <= 0) {
			return res.status(400).json({
				message: "Please set a price for this order",
			});
		}

		const order = await Order.findOne({
			_id: requestId,
			cookId: userId,
			status: "pending",
		});

		if (!order) {
			return res.status(404).json({ message: "Order request not found" });
		}

		const cook = await CookProfile.findOne({ userId });
		if (!cook) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		// ✅ Check if cook has fees enabled
		const addFeesToCustomer = cook.fees?.addFeesToCustomer !== false;

		// ✅ Delivery fee - cook's own delivery fee
		const deliveryFee = order.deliveryFee || 0;

		// ✅ Calculate fees ONLY on food amount (NOT on delivery)
		let serviceFee = 0;
		let paystackFee = 0;
		let totalAmount = 0;

		if (addFeesToCustomer) {
			// Fees added to customer (only on food)
			serviceFee = amount * 0.05;
			paystackFee = (amount + serviceFee) * 0.015 + 1;
			totalAmount =
				Math.round((amount + serviceFee + paystackFee + deliveryFee) * 100) /
				100;
		} else {
			// Cook absorbs fees
			totalAmount = Math.round((amount + deliveryFee) * 100) / 100;
			serviceFee = amount * 0.05;
			paystackFee = (amount + serviceFee) * 0.015 + 1;
		}

		console.log("💰 Custom Order Calculation:", {
			foodAmount: amount,
			deliveryFee: deliveryFee,
			serviceFee: serviceFee,
			paystackFee: paystackFee,
			addFeesToCustomer: addFeesToCustomer,
			totalAmount: totalAmount,
		});

		// Update order
		order.subtotal = amount;
		order.serviceFee = Math.round(serviceFee * 100) / 100;
		order.paystackFee = Math.round(paystackFee * 100) / 100;
		order.totalAmount = totalAmount;
		order.feesAddedToCustomer = addFeesToCustomer;
		order.status = "confirmed";
		order.paymentStatus = "pending";
		await order.save();

		// Generate payment link
		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();
		order.paymentReference = paymentReference;

		const paystackResponse = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email: order.customerEmail || `${order.customerPhone}@getameal.com`,
				amount: Math.round(totalAmount * 100),
				reference: paymentReference,
				callback_url: `${process.env.API_URL}/customer/payment/callback`,
				metadata: {
					orderId: order._id.toString(),
					cookId: userId.toString(),
					customerName: order.customerName,
					customerPhone: order.customerPhone,
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

		// Send WhatsApp with payment link
		const whatsappMessage = `Hi ${order.customerName}! 🍽️

Your order has been accepted by ${cook.storeName}!

📋 Order Details:
• Order: ${order.customOrderTitle || order.customerNote || "Custom Order"}
• Food Amount: ₦${amount.toFixed(2)}
${deliveryFee > 0 ? `• Delivery Fee: ₦${deliveryFee.toFixed(2)}` : ""}
• Total: ₦${totalAmount.toFixed(2)}
• Ready: ${new Date(order.readyDate).toLocaleDateString()}

🔗 Pay here: ${order.paymentLink}

Thank you for choosing ${cook.storeName}!`;

		const whatsappUrl = `https://wa.me/${order.customerPhone}?text=${encodeURIComponent(whatsappMessage)}`;

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
				paymentLink: order.paymentLink,
				status: order.status,
				whatsappUrl: whatsappUrl,
			},
		});
	} catch (error) {
		console.error("Accept order error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Decline order request - WITH reason (optional)
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

		// Get cook profile
		const cook = await CookProfile.findOne({ userId });
		if (!cook) {
			return res.status(404).json({ message: "Cook profile not found" });
		}

		order.status = "cancelled";
		order.sellerNote = reason || "Order request declined";
		await order.save();

		// Send WhatsApp message to customer
		const declineReason = reason || "Unable to fulfill your order at this time";
		const whatsappMessage = `Hi ${order.customerName}! 

Your food request has been declined by ${cook.storeName}.

Reason: ${declineReason}

We apologize for any inconvenience. Please feel free to try another cook.

Thank you for choosing GetAMeal!`;

		const whatsappUrl = `https://wa.me/${order.customerPhone}?text=${encodeURIComponent(whatsappMessage)}`;

		// Send push notification to cook
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
			whatsappUrl: whatsappUrl,
		});
	} catch (error) {
		console.error("Decline order request error:", error);
		res.status(500).json({ message: error.message });
	}
};

// controllers/orderController.js - Fixed createCustomOrder

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

		// ✅ Delivery fee - cook's own delivery fee
		const deliveryFeeAmount = deliveryFee || 0;

		// ✅ Calculate fees ONLY on food amount (NOT on delivery)
		let serviceFee = 0;
		let paystackFee = 0;
		let totalAmount = 0;

		if (addFeesToCustomer) {
			serviceFee = amount * 0.05;
			paystackFee = (amount + serviceFee) * 0.015 + 1;
			totalAmount =
				Math.round(
					(amount + serviceFee + paystackFee + deliveryFeeAmount) * 100,
				) / 100;
		} else {
			totalAmount = Math.round((amount + deliveryFeeAmount) * 100) / 100;
			serviceFee = amount * 0.05;
			paystackFee = (amount + serviceFee) * 0.015 + 1;
		}

		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();

		const order = await Order.create({
			cookId: userId,
			customerId: customer._id,
			customerName: customer.fullName,
			customerPhone: customer.phoneNumber,
			orderType: "custom_order",
			customOrderTitle: title,
			customOrderDescription: description,
			deliveryType: deliveryType || "pickup",
			deliveryFee: deliveryFeeAmount,
			readyDate: new Date(readyDate),
			readyTime: readyTime || "12:00",
			pickupWindow: pickupWindow || cook.pickupWindow,
			subtotal: amount,
			serviceFee: Math.round(serviceFee * 100) / 100,
			paystackFee: Math.round(paystackFee * 100) / 100,
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

		// Send WhatsApp to customer
		const whatsappMessage = `Hi ${customer.fullName}! 

Your custom order has been created by ${cook.storeName}!

Order Details:
• Order: ${title}
• Food Amount: ₦${amount.toFixed(2)}
${deliveryFeeAmount > 0 ? `• Delivery Fee: ₦${deliveryFeeAmount.toFixed(2)}` : ""}
• Total: ₦${totalAmount.toFixed(2)}
• Ready: ${new Date(readyDate).toLocaleDateString()}
• Time: ${readyTime || "12:00"}

Pay here: ${order.paymentLink}

Thank you for choosing ${cook.storeName}!`;

		const whatsappUrl = `https://wa.me/${customer.phoneNumber}?text=${encodeURIComponent(whatsappMessage)}`;

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
				paymentLink: order.paymentLink,
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
// controllers/orderController.js - Fixed createOrderFromCart

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

		// Validate required fields
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

		// Validate phone number
		const phoneRegex = /^[0-9]{11}$/;
		if (!phoneRegex.test(customerPhone.replace(/\D/g, ""))) {
			return res.status(400).json({
				message: "Please enter a valid 11-digit phone number",
			});
		}

		// Get cart
		const cart = await Cart.findOne({ sessionId });
		if (!cart || cart.items.length === 0) {
			return res.status(400).json({ message: "Cart is empty" });
		}

		// Get cook ID from first item
		const firstProduct = await Meal.findById(cart.items[0].productId);
		if (!firstProduct) {
			return res.status(404).json({ message: "Product not found" });
		}
		const cookId = firstProduct.cookId;

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

		// ✅ Check if cook has fees enabled
		const addFeesToCustomer = cook.fees?.addFeesToCustomer !== false; // Default: true

		// Validate ready date
		const readyDateTime = new Date(readyDate);
		if (readyDateTime < new Date()) {
			return res
				.status(400)
				.json({ message: "Ready date must be in the future" });
		}

		// Validate delivery address ONLY if delivery type is delivery
		if (deliveryType === "delivery" && !deliveryAddress) {
			return res.status(400).json({
				message: "Delivery address is required for delivery orders",
			});
		}

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

		// Build order items from cart
		const orderItems = [];
		let foodSubtotal = 0; // ✅ Renamed for clarity

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

			// Use product price
			const itemPrice = product.price;
			let itemSubtotal = itemPrice * cartItem.quantity;

			// Process add-ons
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

		// ✅ Delivery fee - cook's own delivery fee (no platform fee on this)
		const deliveryFee = deliveryType === "delivery" ? cook.deliveryFee || 0 : 0;

		// ✅ Calculate fees ONLY on food subtotal (NOT on delivery fee)
		let serviceFee = 0;
		let paystackFee = 0;
		let totalAmount = 0;

		if (addFeesToCustomer) {
			// ✅ Fees added to customer price (only on food)
			serviceFee = foodSubtotal * 0.05; // 5% platform fee on food only
			paystackFee = (foodSubtotal + serviceFee) * 0.015 + 1; // Paystack fee on food only
			totalAmount =
				Math.round(
					(foodSubtotal + serviceFee + paystackFee + deliveryFee) * 100,
				) / 100;
		} else {
			// ✅ Fees NOT added to customer - cook absorbs fees
			totalAmount = Math.round((foodSubtotal + deliveryFee) * 100) / 100;
			// Fees calculated for payout deduction (on food only)
			serviceFee = foodSubtotal * 0.05;
			paystackFee = (foodSubtotal + serviceFee) * 0.015 + 1;
		}

		console.log("💰 Order Calculation:", {
			foodSubtotal: foodSubtotal,
			deliveryFee: deliveryFee,
			serviceFee: serviceFee,
			paystackFee: paystackFee,
			addFeesToCustomer: addFeesToCustomer,
			totalAmount: totalAmount,
		});

		// Create order
		const orderData = {
			cookId,
			customerId: customer._id,
			customerName,
			customerPhone: customerPhone.replace(/\D/g, ""),
			customerEmail: customerEmail || "",
			customerNote: customerNote || "",
			deliveryType,
			deliveryAddress: deliveryType === "delivery" ? deliveryAddress : null,
			deliveryFee: deliveryFee,
			readyDate: readyDateTime,
			readyTime: "12:00",
			status: "pending",
			paymentStatus: "pending",
			orderType: "product_order",
			items: orderItems,
			subtotal: Math.round(foodSubtotal * 100) / 100,
			serviceFee: Math.round(serviceFee * 100) / 100,
			paystackFee: Math.round(paystackFee * 100) / 100,
			totalAmount: totalAmount,
			feesAddedToCustomer: addFeesToCustomer,
			pickupWindow: {
				from: cook.pickupWindow.from,
				to: cook.pickupWindow.to,
			},
			sessionId: sessionId,
		};

		const order = await Order.create(orderData);

		// Update customer stats
		await Customer.findByIdAndUpdate(customer._id, {
			$inc: { ordersCount: 1, totalSpent: totalAmount },
			$set: { lastOrderDate: new Date() },
		});

		// Clear cart
		await Cart.findOneAndDelete({ sessionId });

		// Generate payment link
		const paymentReference =
			"PAY-" + crypto.randomBytes(6).toString("hex").toUpperCase();
		order.paymentReference = paymentReference;

		const paystackResponse = await axios.post(
			"https://api.paystack.co/transaction/initialize",
			{
				email: customerEmail || `${customerPhone}@getameal.com`,
				amount: Math.round(totalAmount * 100),
				reference: paymentReference,
				callback_url: `${process.env.API_URL}/customer/payment/callback`,
				metadata: {
					orderId: order._id.toString(),
					cookId: cookId.toString(),
					customerName,
					customerPhone: customerPhone.replace(/\D/g, ""),
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

		// Send push notification to cook
		await sendPushToUser(
			cookId,
			"New Order Received 🆕",
			`${customerName} placed a new order for ₦${totalAmount.toFixed(2)}`,
			{
				type: "new_order",
				orderId: order._id.toString(),
			},
		);

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
