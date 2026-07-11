export const requestPayout = async (cookId, amount) => {
	const cook = await User.findById(cookId);

	if (cook.walletBalance < amount) {
		throw new Error("Insufficient balance");
	}

	const response = await axios.post(
		"https://api.paystack.co/transfer",
		{
			source: "balance",
			amount: amount * 100,
			recipient: cook.bankRecipientCode,
		},
		{
			headers: {
				Authorization: `Bearer ${process.env.PAYSTACK_SECRET}`,
			},
		},
	);

	cook.walletBalance -= amount;
	await cook.save();
};
