import * as mediaToolsClient from "../services/media-tools-client";

export const DOMAIN_TOOL_MAP: Record<string, string[]> = {
	"service-health": ["checkServiceHealth", "getDiskSpace"],
	"download-queue": [
		"getTorrents",
		"pauseTorrent",
		"resumeTorrent",
		"pauseAllTorrents",
		"resumeAllTorrents",
		"getNZBGetQueue",
	],
};

const CONFIDENCE_THRESHOLD = 0.7;

export async function narrowToolsForMessage(
	message: string,
	tools: Record<string, any>,
): Promise<Record<string, any>> {
	try {
		const { domain, confidence } = await mediaToolsClient.classifyIntent(message);
		if (domain && confidence >= CONFIDENCE_THRESHOLD && DOMAIN_TOOL_MAP[domain]) {
			const narrowed: Record<string, any> = {};
			for (const name of DOMAIN_TOOL_MAP[domain]) {
				if (tools[name]) narrowed[name] = tools[name];
			}
			if (Object.keys(narrowed).length > 0) return narrowed;
		}
	} catch {
		// fail open — Step 0 must never block a message
	}
	return tools;
}
