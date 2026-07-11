import { RtcRole, RtcTokenBuilder } from "agora-access-token";

export const generateAgoraToken = (channel, uid) => {
	const token = RtcTokenBuilder.buildTokenWithUid(
		process.env.AGORA_APP_ID,
		process.env.AGORA_CERT,
		channel,
		uid,
		RtcRole.PUBLISHER,
		Math.floor(Date.now() / 1000) + 3600,
	);

	return token;
};
