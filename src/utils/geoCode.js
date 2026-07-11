// utils/geocode.js
import axios from "axios";

export const getCityCoordinates = async (city, stateCode) => {
	try {
		const res = await axios.get(
			"https://api.opencagedata.com/geocode/v1/json",
			{
				params: {
					q: `${city}, ${stateCode}, Nigeria`,
					key: process.env.OPENCAGE_KEY,
				},
			},
		);

		const result = res.data.results[0];

		if (!result) return null;

		return {
			lat: result.geometry.lat,
			lng: result.geometry.lng,
		};
	} catch (error) {
		console.error("Geocode error:", error.message);
		return null;
	}
};
