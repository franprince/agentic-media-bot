import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";
import { saveMediaEvent } from "../database";
import { parseWebhookEvent } from "../webhookParser";

// These tests share the real SQLite DB used by the services, matching the
// isolation approach in media_events.test.ts.
const db = new Database(join("data", "bot_data.sqlite"));

function cleanupService(service: string) {
	db.run("DELETE FROM media_events WHERE service = ?", [service]);
}

function jsonRequest(body: unknown): Request {
	return new Request("http://localhost/webhook", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("parseWebhookEvent", () => {
	test("parses an NZBGet payload including speed and ETA", async () => {
		const parsed = await parseWebhookEvent(
			jsonRequest({ event: "added", title: "Some.Movie.2026", speed: 12, eta: "5m" }),
			"/nzbget-webhook",
		);

		expect(parsed).not.toBeNull();
		expect(parsed!.service).toBe("nzbget");
		expect(parsed!.event).toBe("added");
		expect(parsed!.title).toBe("Some.Movie.2026");
		expect(parsed!.message).toBe(
			"NZBGet Event: added - Some.Movie.2026 (12 MB/s) [ETA: 5m]",
		);
	});

	test("defaults the NZBGet event to 'added' when absent", async () => {
		const parsed = await parseWebhookEvent(
			jsonRequest({ title: "No.Event.Field" }),
			"/nzbget-webhook",
		);

		expect(parsed!.event).toBe("added");
		expect(parsed!.title).toBe("No.Event.Field");
	});

	test("parses a form-encoded qBittorrent payload", async () => {
		const req = new Request("http://localhost/webhook", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				event: "completed",
				title: "Some.Show.S01E01",
			}).toString(),
		});

		const parsed = await parseWebhookEvent(req, "/qbittorrent-webhook");

		expect(parsed!.service).toBe("qbittorrent");
		expect(parsed!.event).toBe("completed");
		expect(parsed!.title).toBe("Some.Show.S01E01");
	});

	test("formats a Sonarr episode title as 'Series - S01E02 - Episode'", async () => {
		const parsed = await parseWebhookEvent(
			jsonRequest({
				eventType: "Download",
				series: { title: "Captain Tsubasa" },
				episodes: [{ seasonNumber: 1, episodeNumber: 2, title: "The Match" }],
			}),
			"/sonarr-webhook",
		);

		expect(parsed!.service).toBe("sonarr");
		expect(parsed!.event).toBe("Download");
		expect(parsed!.title).toBe("Captain Tsubasa - S01E02 - The Match");
	});

	test("uses the movie title for Radarr payloads", async () => {
		const parsed = await parseWebhookEvent(
			jsonRequest({ eventType: "Grab", movie: { title: "Inception" } }),
			"/radarr-webhook",
		);

		expect(parsed!.service).toBe("radarr");
		expect(parsed!.title).toBe("Inception");
	});

	test("uses grandparentTitle for Plex episode payloads", async () => {
		const payload = {
			event: "library.new",
			Metadata: {
				type: "episode",
				title: "A Wise Decision",
				grandparentTitle: "Captain Tsubasa",
			},
		};
		const form = new FormData();
		form.set("payload", JSON.stringify(payload));

		const parsed = await parseWebhookEvent(
			new Request("http://localhost/webhook", { method: "POST", body: form }),
			"/plex-webhook",
		);

		expect(parsed!.service).toBe("plex");
		expect(parsed!.event).toBe("library.new");
		expect(parsed!.title).toBe("Captain Tsubasa - A Wise Decision");
	});

	test("returns null on a malformed body instead of throwing", async () => {
		const req = new Request("http://localhost/webhook", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{ this is not json",
		});

		expect(await parseWebhookEvent(req, "/nzbget-webhook")).toBeNull();
	});

	test("returns null for a Plex payload with no 'payload' field", async () => {
		const form = new FormData();
		form.set("other", "value");

		const req = new Request("http://localhost/webhook", {
			method: "POST",
			body: form,
		});

		expect(await parseWebhookEvent(req, "/plex-webhook")).toBeNull();
	});
});

describe("media_events dedup — why the proxy must not write on the happy path", () => {
	let service: string;

	afterEach(() => {
		if (service) cleanupService(service);
	});

	test("an identical row inside the 60s window suppresses the second write", () => {
		// This is the bug being fixed. The proxy used to write the event before
		// relaying it. Because both processes share one SQLite file and NZBGet
		// tuples are byte-identical between the two writers, the bot's own
		// dbSave() then returned false and the event queue skipped the Telegram
		// notification entirely.
		service = `test_nzb_${Date.now()}`;
		const title = "Some.Movie.2026";

		// Stand-in for the proxy's pre-relay write.
		expect(saveMediaEvent(service, "added", title, "NZBGet Event: added")).toBe(
			true,
		);

		// Stand-in for the bot's dbSave() on the relayed webhook. False here means
		// "duplicate" — and eventQueue skips send() when dbSave() returns false.
		expect(saveMediaEvent(service, "added", title, "NZBGet Event: added")).toBe(
			false,
		);
	});

	test("a single writer records the event and reports it as new", () => {
		// Post-fix happy path: only the bot writes, so dbSave() returns true and
		// the notification is delivered.
		service = `test_nzb_${Date.now()}_single`;

		expect(
			saveMediaEvent(service, "added", "Only.Writer.2026", "NZBGet Event: added"),
		).toBe(true);
	});

	test("distinct titles are not treated as duplicates", () => {
		service = `test_nzb_${Date.now()}_distinct`;

		expect(saveMediaEvent(service, "added", "First.2026", "m")).toBe(true);
		expect(saveMediaEvent(service, "added", "Second.2026", "m")).toBe(true);
	});
});
