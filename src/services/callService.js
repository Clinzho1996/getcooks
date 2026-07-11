import { RtcRole, RtcTokenBuilder } from "agora-access-token";
import twilio from "twilio";

export const generateAgoraToken = (channel, uid) => {
	return RtcTokenBuilder.buildTokenWithUid(
		process.env.AGORA_APP_ID,
		process.env.AGORA_CERT,
		channel,
		uid,
		RtcRole.PUBLISHER,
		Math.floor(Date.now() / 1000) + 3600,
	);
};

export const generateTwilioToken = (identity) => {
	const AccessToken = twilio.jwt.AccessToken;
	const VideoGrant = AccessToken.VideoGrant;

	const token = new AccessToken(
		process.env.TWILIO_ACCOUNT_SID,
		process.env.TWILIO_API_KEY,
		process.env.TWILIO_API_SECRET,
	);

	token.identity = identity;
	token.addGrant(new VideoGrant());
	return token.toJwt();
};
