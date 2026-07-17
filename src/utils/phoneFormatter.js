// utils/phoneFormatter.js

/**
 * Format phone number to international format (+234XXXXXXXXXX)
 * @param {string} phone - Phone number to format
 * @returns {string} Formatted phone number with +234
 */
export const formatPhoneNumber = (phone) => {
	if (!phone) return null;

	// Remove all non-digit characters
	let cleaned = phone.replace(/\D/g, "");

	// If empty after cleaning
	if (!cleaned) return null;

	// If it already starts with +, return as is
	if (phone.startsWith("+")) {
		return phone;
	}

	// If it starts with 234, add +
	if (cleaned.startsWith("234")) {
		return `+${cleaned}`;
	}

	// Remove leading 0 if present
	if (cleaned.startsWith("0")) {
		cleaned = cleaned.substring(1);
	}

	// If it's 10 digits (without 0), add 234
	if (cleaned.length === 10) {
		return `+234${cleaned}`;
	}

	// If it's 11 digits (with 0 removed), add 234
	if (cleaned.length === 11) {
		return `+234${cleaned}`;
	}

	// If it's 13 digits (already has 234), add +
	if (cleaned.length === 13 && cleaned.startsWith("234")) {
		return `+${cleaned}`;
	}

	// Default: add +234 if less than 13 digits
	if (cleaned.length < 13) {
		// Remove any remaining 234 prefix to avoid duplication
		if (cleaned.startsWith("234")) {
			cleaned = cleaned.substring(3);
		}
		return `+234${cleaned}`;
	}

	return `+${cleaned}`;
};

/**
 * Format phone for WhatsApp (remove + and 234, keep 10-11 digits)
 * @param {string} phone - Phone number to format for WhatsApp
 * @returns {string} Phone number ready for WhatsApp URL
 */
export const formatPhoneForWhatsApp = (phone) => {
	if (!phone) return null;

	// Remove all non-digit characters
	let cleaned = phone.replace(/\D/g, "");

	// If empty after cleaning
	if (!cleaned) return null;

	// Remove leading 0
	if (cleaned.startsWith("0")) {
		cleaned = cleaned.substring(1);
	}

	// Remove 234 prefix
	if (cleaned.startsWith("234")) {
		cleaned = cleaned.substring(3);
	}

	// If less than 10 digits, pad with 234
	if (cleaned.length < 10) {
		return `234${cleaned}`;
	}

	// Return 10-11 digit number for WhatsApp
	return cleaned;
};

/**
 * Get WhatsApp URL for a phone number
 * @param {string} phone - Phone number
 * @param {string} message - Message to send (optional)
 * @returns {string} WhatsApp URL
 */
export const getWhatsAppUrl = (phone, message = "") => {
	const formatted = formatPhoneForWhatsApp(phone);
	if (!formatted) return null;

	const encodedMessage = encodeURIComponent(message);
	return `https://wa.me/${formatted}${encodedMessage ? `?text=${encodedMessage}` : ""}`;
};

/**
 * Validate Nigerian phone number
 * @param {string} phone - Phone number to validate
 * @returns {boolean} True if valid Nigerian phone number
 */
export const isValidNigerianPhone = (phone) => {
	if (!phone) return false;

	const cleaned = phone.replace(/\D/g, "");

	// Should be 10-11 digits (with or without 0)
	// or 13 digits with 234
	if (cleaned.length === 10 || cleaned.length === 11) {
		return true;
	}

	if (cleaned.length === 13 && cleaned.startsWith("234")) {
		return true;
	}

	return false;
};

/**
 * Extract raw phone number (digits only)
 * @param {string} phone - Phone number
 * @returns {string} Raw digits only
 */
export const getRawPhoneNumber = (phone) => {
	if (!phone) return null;
	return phone.replace(/\D/g, "");
};

/**
 * Get display phone number (human readable)
 * @param {string} phone - Phone number
 * @returns {string} Formatted display number (e.g., 080 1234 5678)
 */
export const getDisplayPhoneNumber = (phone) => {
	const raw = getRawPhoneNumber(phone);
	if (!raw) return null;

	// Format as 080 1234 5678
	if (raw.length === 11) {
		return `${raw.substring(0, 3)} ${raw.substring(3, 7)} ${raw.substring(7, 11)}`;
	}

	// Format as 234 80 1234 5678
	if (raw.length === 13) {
		return `${raw.substring(0, 3)} ${raw.substring(3, 5)} ${raw.substring(5, 9)} ${raw.substring(9, 13)}`;
	}

	return raw;
};
