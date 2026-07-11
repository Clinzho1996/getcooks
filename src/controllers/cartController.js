// controllers/cartController.js - Public
import Cart from "../models/Cart.js";
import Meal from "../models/Meal.js";

// Add to cart
export const addToCart = async (req, res) => {
	try {
		const { sessionId, productId, quantity = 1, addOns = [] } = req.body;

		if (!sessionId) {
			return res.status(400).json({ message: "Session ID is required" });
		}

		if (!productId) {
			return res.status(400).json({ message: "Product ID is required" });
		}

		// Get product details
		const product = await Meal.findById(productId);
		if (!product) {
			return res.status(404).json({ message: "Product not found" });
		}

		if (!product.isAvailable) {
			return res
				.status(400)
				.json({ message: "Product is currently unavailable" });
		}

		// Find or create cart
		let cart = await Cart.findOne({ sessionId });
		if (!cart) {
			cart = new Cart({ sessionId, items: [] });
		}

		// Check if product already in cart
		const existingItem = cart.items.find(
			(item) => item.productId.toString() === productId,
		);

		if (existingItem) {
			existingItem.quantity += quantity;
			if (addOns.length > 0) {
				existingItem.addOns = addOns;
			}
		} else {
			cart.items.push({
				productId,
				name: product.name,
				price: product.price,
				customerPrice: product.customerPrice,
				quantity,
				addOns,
				image:
					product.images && product.images.length > 0
						? product.images[0].url
						: null,
			});
		}

		// Calculate subtotal
		let subtotal = 0;
		cart.items.forEach((item) => {
			subtotal += (item.customerPrice || item.price) * item.quantity;
		});
		cart.subtotal = subtotal;

		await cart.save();

		res.status(200).json({
			success: true,
			message: "Item added to cart",
			cart: {
				items: cart.items,
				subtotal: cart.subtotal,
				totalItems: cart.items.reduce((sum, item) => sum + item.quantity, 0),
			},
		});
	} catch (error) {
		console.error("Add to cart error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Get cart
export const getCart = async (req, res) => {
	try {
		const { sessionId } = req.params;

		if (!sessionId) {
			return res.status(400).json({ message: "Session ID is required" });
		}

		const cart = await Cart.findOne({ sessionId });

		if (!cart) {
			return res.json({
				success: true,
				cart: {
					items: [],
					subtotal: 0,
					totalItems: 0,
				},
			});
		}

		// Check product availability
		const itemsWithAvailability = await Promise.all(
			cart.items.map(async (item) => {
				const product = await Meal.findById(item.productId);
				return {
					...item.toObject(),
					isAvailable: product ? product.isAvailable : false,
					productExists: !!product,
				};
			}),
		);

		res.json({
			success: true,
			cart: {
				items: itemsWithAvailability,
				subtotal: cart.subtotal,
				totalItems: cart.items.reduce((sum, item) => sum + item.quantity, 0),
			},
		});
	} catch (error) {
		console.error("Get cart error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Remove from cart
export const removeFromCart = async (req, res) => {
	try {
		const { sessionId, productId } = req.params;

		if (!sessionId) {
			return res.status(400).json({ message: "Session ID is required" });
		}

		const cart = await Cart.findOne({ sessionId });

		if (!cart) {
			return res.status(404).json({ message: "Cart not found" });
		}

		cart.items = cart.items.filter(
			(item) => item.productId.toString() !== productId,
		);

		// Recalculate subtotal
		let subtotal = 0;
		cart.items.forEach((item) => {
			subtotal += (item.customerPrice || item.price) * item.quantity;
		});
		cart.subtotal = subtotal;

		await cart.save();

		res.json({
			success: true,
			message: "Item removed from cart",
			cart: {
				items: cart.items,
				subtotal: cart.subtotal,
				totalItems: cart.items.reduce((sum, item) => sum + item.quantity, 0),
			},
		});
	} catch (error) {
		console.error("Remove from cart error:", error);
		res.status(500).json({ message: error.message });
	}
};

// Clear cart
export const clearCart = async (req, res) => {
	try {
		const { sessionId } = req.params;

		if (!sessionId) {
			return res.status(400).json({ message: "Session ID is required" });
		}

		await Cart.findOneAndDelete({ sessionId });

		res.json({
			success: true,
			message: "Cart cleared",
			cart: {
				items: [],
				subtotal: 0,
				totalItems: 0,
			},
		});
	} catch (error) {
		console.error("Clear cart error:", error);
		res.status(500).json({ message: error.message });
	}
};
