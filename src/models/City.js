// models/City.js
import mongoose from "mongoose";

const citySchema = new mongoose.Schema(
	{
		name: String,
		stateCode: String,
		latitude: Number,
		longitude: Number,
	},
	{ timestamps: true },
);

export default mongoose.model("City", citySchema);
