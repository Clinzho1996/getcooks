import Meal from "../models/Meal";
import Order from "../models/Order";

export const createOrder = async (userId, payload) => {
	const meal = await Meal.findById(payload.mealId);

	if (meal.portionsRemaining < payload.quantity) {
		throw new Error("Not enough portions");
	}

	meal.portionsRemaining -= payload.quantity;
	await meal.save();

	const order = await Order.create({
		userId,
		cookId: meal.cookId,
		mealItems: [
			{
				mealId: meal._id,
				quantity: payload.quantity,
				price: meal.price,
			},
		],
		deliveryType: payload.deliveryType,
		totalAmount: meal.price * payload.quantity,
		paymentStatus: "pending",
		status: "pending",
	});

	return order;
};
