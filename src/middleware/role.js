export const adminOnly = (req, res, next) => {
	if (req.user.role !== "admin")
		return res.status(403).json({ message: "Admin access only" });
	next();
};

export const cookOnly = (req, res, next) => {
	if (req.user.role !== "cook")
		return res.status(403).json({ message: "Cook access only" });
	next();
};
