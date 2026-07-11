import axios from "axios";

export const initializePayment = async (order) => {
	const response = await axios.post(
		"https://api.paystack.co/transaction/initialize",
		{
			email: order.userEmail,
			amount: order.totalAmount * 100,
			reference: order._id.toString(),
		},
		{
			headers: {
				Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
			},
		},
	);

	return response.data.data;
};
