export type IntentDomain = "service-health" | "download-queue";

export interface IntentClassification {
	domain: IntentDomain | null;
	confidence: number;
}

const KNOWN_DOMAINS: IntentDomain[] = ["service-health", "download-queue"];

const FAIL_OPEN: IntentClassification = { domain: null, confidence: 0 };

const CLASSIFIER_PROMPT = `You classify a user's message into one of these domains, or none:
- "service-health": asking whether a service (Radarr, Sonarr, Plex, qBittorrent, NZBGet) is online, or asking about disk space.
- "download-queue": asking about the torrent/NZB download queue, or asking to pause/resume downloads.

Respond with strict JSON only, no other text: {"domain": "service-health" | "download-queue" | null, "confidence": 0-1}

Message: `;

export async function classifyIntent(message: string): Promise<IntentClassification> {
	try {
		const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(
			/\/$/,
			"",
		);
		const model =
			process.env.OLLAMA_CLASSIFIER_MODEL || process.env.OLLAMA_MODEL || "llama3.1";

		const res = await fetch(`${baseUrl}/api/generate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model,
				prompt: `${CLASSIFIER_PROMPT}${message}`,
				stream: false,
				format: "json",
			}),
			signal: AbortSignal.timeout(5000),
		});

		if (!res.ok) return FAIL_OPEN;

		const data = (await res.json()) as { response?: string };
		if (!data.response) return FAIL_OPEN;

		const parsed = JSON.parse(data.response) as {
			domain?: string | null;
			confidence?: number;
		};

		if (!parsed.domain || !KNOWN_DOMAINS.includes(parsed.domain as IntentDomain)) {
			return FAIL_OPEN;
		}

		return {
			domain: parsed.domain as IntentDomain,
			confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
		};
	} catch {
		return FAIL_OPEN;
	}
}
