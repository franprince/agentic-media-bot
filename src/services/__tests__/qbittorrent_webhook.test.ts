import {
	afterAll,
	beforeAll,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import type { Bot } from "grammy";
import * as database from "../database";
import { handleQBittorrentWebhook, handleNZBGetWebhook, handleRadarrWebhook } from "../webhooks";

describe("qBittorrent & NZBGet Webhook Notifications", () => {
	let spies: any[] = [];
	let pendingNotifications: any[] = [];

	beforeAll(() => {
		pendingNotifications = [
			{ id: "sub_1", user_id: 999, media_type: "movie", media_id: 1012306, title: "Leviticus" }
		];
		spies = [
			spyOn(database, "areNotificationsEnabled").mockImplementation(() => true),
			spyOn(database, "saveMediaEvent").mockImplementation(() => true),
			spyOn(database, "getEventAlertConfig").mockImplementation(() => true),
			spyOn(database, "getAllPendingNotifications").mockImplementation(() => pendingNotifications),
			spyOn(database, "getPendingNotifications").mockImplementation(() => pendingNotifications),
		];
	});

	afterAll(() => {
		for (const s of spies) {
			if (s && s.mockRestore) s.mockRestore();
		}
	});

	const mockBotData = {
		api: {
			sendMessage: async (chatId: number | string, text: string, options: any) => ({
				message_id: 1,
			}),
		},
	};

	const mockBot = mockBotData as unknown as Bot;
	const sendMessageSpy = spyOn(mockBotData.api, "sendMessage");

	it("should process qBittorrent JSON added webhook and send personal notification on title match", async () => {
		sendMessageSpy.mockClear();
		const payload = {
			event: "added",
			title: "Leviticus.2026.1080p.BluRay-x264",
			hash: "hash123",
		};

		const request = new Request("http://localhost/qbittorrent-webhook", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		const response = await handleQBittorrentWebhook(request, mockBot);
		expect(response.status).toBe(200);
		expect(sendMessageSpy).toHaveBeenCalled();
		// It should notify the target user who subscribed
		const calls = sendMessageSpy.mock.calls;
		const personalCall = calls.find(c => c[0] === 999);
		expect(personalCall).toBeDefined();
		expect(personalCall![1]).toContain("Your movie *Leviticus* has started downloading via qBittorrent!");
	});

	it("should process qBittorrent URL-encoded started webhook and send personal notification", async () => {
		sendMessageSpy.mockClear();
		const formData = "event=started&title=Leviticus.2026.1080p&hash=hash456";

		const request = new Request("http://localhost/qbittorrent-webhook", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: formData,
		});

		const response = await handleQBittorrentWebhook(request, mockBot);
		expect(response.status).toBe(200);
		expect(sendMessageSpy).toHaveBeenCalled();
		const calls = sendMessageSpy.mock.calls;
		const personalCall = calls.find(c => c[0] === 999);
		expect(personalCall).toBeDefined();
		expect(personalCall![1]).toContain("started downloading via qBittorrent");
	});

	it("should process NZBGet webhook and notify subscribed users on title match", async () => {
		sendMessageSpy.mockClear();
		const payload = {
			event: "added",
			title: "Leviticus (2026)",
			speed: 15,
			eta: "00:05:00",
		};

		const request = new Request("http://localhost/nzbget-webhook", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		const response = await handleNZBGetWebhook(request, mockBot);
		expect(response.status).toBe(200);
		expect(sendMessageSpy).toHaveBeenCalled();
		const calls = sendMessageSpy.mock.calls;
		const personalCall = calls.find(c => c[0] === 999);
		expect(personalCall).toBeDefined();
		expect(personalCall![1]).toContain("started downloading via NZBGet");
	});

	it("should send personal notification when Radarr Grab webhook is received", async () => {
		sendMessageSpy.mockClear();
		const payload = {
			eventType: "Grab",
			movie: { title: "Leviticus", year: 2026, tmdbId: 1012306 },
			release: {
				quality: "1080p",
				releaseTitle: "Leviticus.2026.1080p.BluRay",
			},
			downloadClient: "qBittorrent",
		};

		const request = new Request("http://localhost/radarr-webhook", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});

		const response = await handleRadarrWebhook(request, mockBot);
		expect(response.status).toBe(200);
		expect(sendMessageSpy).toHaveBeenCalled();
		// Look for the call to user 999
		const calls = sendMessageSpy.mock.calls;
		const personalCall = calls.find(c => c[0] === 999);
		expect(personalCall).toBeDefined();
		expect(personalCall![1]).toContain("Your movie *Leviticus* has started downloading via qBittorrent");
	});
});
