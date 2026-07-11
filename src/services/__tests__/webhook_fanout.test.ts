import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import * as database from "../database";

// --- Multi-user notification fan-out tests ---
// We test getNotifyTargets indirectly through the webhook handlers by verifying
// that sendMessage is called once per allowed user ID.

/** Wait for the event queue's async drain loop to finish. */
const drainQueue = () => new Promise((resolve) => setTimeout(resolve, 100));

describe("Multi-user webhook notification fan-out", () => {
	let sendMessageSpy: ReturnType<typeof spyOn>;
	let mockBot: any;
	let spies: any[] = [];

	beforeEach(() => {
		sendMessageSpy = spyOn({ fn: async () => {} }, "fn");
		mockBot = {
			api: {
				sendMessage: mock(async () => {}),
				sendPhoto: mock(async () => {}),
			},
		};
		sendMessageSpy = spyOn(mockBot.api, "sendMessage");

		spies = [
			spyOn(database, "areNotificationsEnabled").mockImplementation(() => true),
			spyOn(database, "getEventAlertConfig").mockImplementation(() => true),
			spyOn(database, "saveMediaEvent").mockImplementation(() => true),
			spyOn(database, "getPlaybackState").mockImplementation(() => null),
			spyOn(database, "updatePlaybackState").mockImplementation(
				() => undefined,
			),
			spyOn(database, "getPendingNotifications").mockImplementation(() => []),
		];
	});

	afterEach(() => {
		for (const s of spies) {
			if (s && s.mockRestore) s.mockRestore();
		}
	});

	test("should send Radarr notification to ALL users when WEBHOOK_NOTIFY_CHAT_ID is not set", async () => {
		const { handleRadarrWebhook } = await import("../webhooks");

		process.env.ALLOWED_USER_IDS = "111,222,333";
		delete process.env.WEBHOOK_NOTIFY_CHAT_ID;

		const payload = {
			eventType: "Download",
			movie: { title: "Inception", year: 2010 },
			movieFile: { quality: { quality: { name: "Bluray-1080p" } } },
			downloadClient: "NZBGet",
		};

		const request = new Request("http://localhost/radarr-webhook", {
			method: "POST",
			body: JSON.stringify(payload),
		});

		await handleRadarrWebhook(request, mockBot);
		// Queue sends notifications asynchronously — wait for drain
		await drainQueue();

		const calls = (sendMessageSpy as any).mock.calls;
		const targets = calls.map((c: any[]) => c[0]);

		expect(targets).toContain("111");
		expect(targets).toContain("222");
		expect(targets).toContain("333");
		expect(calls.length).toBe(3);
	});

	test("should send Radarr notification only to WEBHOOK_NOTIFY_CHAT_ID when it is set (backward compat)", async () => {
		const { handleRadarrWebhook } = await import("../webhooks");

		process.env.ALLOWED_USER_IDS = "111,222,333";
		process.env.WEBHOOK_NOTIFY_CHAT_ID = "999";

		const payload = {
			eventType: "Download",
			movie: { title: "Inception", year: 2010 },
			movieFile: { quality: { quality: { name: "Bluray-1080p" } } },
			downloadClient: "NZBGet",
		};

		const request = new Request("http://localhost/radarr-webhook", {
			method: "POST",
			body: JSON.stringify(payload),
		});

		await handleRadarrWebhook(request, mockBot);
		await drainQueue();

		const calls = (sendMessageSpy as any).mock.calls;
		const targets = calls.map((c: any[]) => c[0]);

		expect(targets).toContain("999");
		expect(targets).not.toContain("111");
		expect(targets).not.toContain("222");
		expect(calls.length).toBe(1);
	});

	test("should send Sonarr notification to ALL users when WEBHOOK_NOTIFY_CHAT_ID is not set", async () => {
		const { handleSonarrWebhook } = await import("../webhooks");

		process.env.ALLOWED_USER_IDS = "100,200";
		delete process.env.WEBHOOK_NOTIFY_CHAT_ID;

		const payload = {
			eventType: "Download",
			series: { title: "Breaking Bad", tvdbId: 81189 },
			episodes: [{ seasonNumber: 1, episodeNumber: 1, title: "Pilot" }],
			episodeFile: { quality: { quality: { name: "HDTV-1080p" } } },
			downloadClient: "qBittorrent",
		};

		const request = new Request("http://localhost/sonarr-webhook", {
			method: "POST",
			body: JSON.stringify(payload),
		});

		await handleSonarrWebhook(request, mockBot);
		await drainQueue();

		const calls = (sendMessageSpy as any).mock.calls;
		const targets = calls.map((c: any[]) => c[0]);

		expect(targets).toContain("100");
		expect(targets).toContain("200");
		expect(calls.length).toBe(2);
	});
});
