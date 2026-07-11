import mongoose from "mongoose";

const zoneSchema = new mongoose.Schema(
	{
		name: { type: String, required: true, unique: true },
		coverageAreas: [{ type: String, required: true }],
		isActive: { type: Boolean, default: false },
	},
	{ timestamps: true },
);

export default mongoose.model("Zone", zoneSchema);
