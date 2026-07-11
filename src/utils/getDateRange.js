export const getDateRanges = (start, end) => {
	const currentStart = new Date(start);
	const currentEnd = new Date(end);

	const diff = currentEnd - currentStart;

	const prevStart = new Date(currentStart.getTime() - diff);
	const prevEnd = new Date(currentStart);

	return {
		currentStart,
		currentEnd,
		prevStart,
		prevEnd,
	};
};
