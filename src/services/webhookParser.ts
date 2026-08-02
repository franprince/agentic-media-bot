/**
 * Webhook payload parsing.
 *
 * Extracted from the proxy's relay block so it can be unit-tested: importing
 * `src/proxy.ts` executes top-level side effects (it exits the process when
 * PROXY_SECRET_KEY is unset, then binds a port), so nothing defined inside it
 * is reachable from a test.
 *
 * This module is deliberately side-effect free — no database access, no file
 * writes, no network. It turns a request body into a plain descriptor and lets
 * the caller decide what to do with it.
 */

export interface ParsedWebhookEvent {
	/** Originating service: "plex" | "nzbget" | "qbittorrent" | "radarr" | "sonarr". */
	service: string;
	/** Service-specific event name, as sent by the service (casing preserved). */
	event: string;
	/** Human-readable media title the event refers to. */
	title: string;
	/** Pre-formatted one-line summary used for log output and history rows. */
	message: string;
}

/**
 * Parses a webhook request body into a {@link ParsedWebhookEvent}.
 *
 * @param req      A **clone** of the incoming request. The body is consumed
 *                 here, so passing the original would leave nothing to relay.
 * @param pathname The request path, used to pick the payload shape.
 *
 * Returns `null` when the payload can't be parsed, or when it yields no usable
 * service/event pair. Callers must treat `null` as "log it and move on" —
 * a malformed payload must never stop the relay from being attempted.
 */
export async function parseWebhookEvent(
	req: Request,
	pathname: string,
): Promise<ParsedWebhookEvent | null> {
	try {
		let service = "";
		let event = "";
		let title = "";
		let message = "";

		if (pathname === "/plex-webhook") {
			service = "plex";
			const formData = await req.formData();
			const payloadRaw = formData.get("payload");
			if (!payloadRaw || typeof payloadRaw !== "string") {
				throw new Error("Missing 'payload' in Plex webhook");
			}
			const payload = JSON.parse(payloadRaw);
			event = payload.event || "unknown";

			const m = payload.Metadata || {};
			if (m.type === "episode" && m.grandparentTitle) {
				title = `${m.grandparentTitle} - ${m.title}`;
			} else {
				title = m.title || "Unknown Title";
			}

			message = `Plex Event: ${event} - ${title}`;
		} else if (
			pathname === "/api/nzbget-webhook" ||
			pathname === "/nzbget-webhook"
		) {
			service = "nzbget";
			const payload = (await req.json()) as any;
			event = payload.event || "added";
			title = payload.title || "Unknown NZB";
			const speed = payload.speed ? ` (${payload.speed} MB/s)` : "";
			const eta = payload.eta ? ` [ETA: ${payload.eta}]` : "";
			message = `NZBGet Event: ${event} - ${title}${speed}${eta}`;
		} else if (
			pathname === "/qbittorrent-webhook" ||
			pathname === "/api/qbittorrent-webhook"
		) {
			service = "qbittorrent";
			let payload: any = {};
			const contentType = req.headers.get("content-type") || "";
			if (contentType.includes("application/json")) {
				payload = await req.json();
			} else {
				const text = await req.text();
				const params = new URLSearchParams(text);
				payload = Object.fromEntries(params.entries());
			}
			event = payload.event || "added";
			title = payload.title || "Unknown Torrent";
			message = `qBittorrent Event: ${event} - ${title}`;
		} else {
			service = pathname.includes("radarr") ? "radarr" : "sonarr";
			const payload = (await req.json()) as any;
			event = payload.eventType || "unknown";

			if (service === "sonarr" && payload.series) {
				const seriesName = payload.series.title;
				let epDetails = "";
				if (payload.episodes && payload.episodes.length > 0) {
					const ep = payload.episodes[0];
					epDetails = ` - S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")} - ${ep.title}`;
				}
				title = `${seriesName}${epDetails}`;
			} else if (service === "radarr" && payload.movie) {
				title = payload.movie.title;
			} else {
				title = payload.movie?.title || payload.series?.title || "Unknown Title";
			}

			message = `${service.charAt(0).toUpperCase() + service.slice(1)} Event: ${event} - ${title}`;
		}

		// Mirrors the original `if (service && event)` guard: without both, there
		// is nothing worth recording.
		if (!service || !event) return null;

		return { service, event, title, message };
	} catch (err) {
		console.error(`Failed to parse webhook payload for ${pathname}:`, err);
		return null;
	}
}
