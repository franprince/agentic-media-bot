import { describe, expect, it, spyOn, mock, beforeAll, afterAll } from "bun:test";
import { Bot } from "grammy";
import * as database from "../database";

let handleRadarrWebhook: any;
let handleSonarrWebhook: any;
let spies: any[] = [];

describe("Radarr/Sonarr Webhook Notifications", () => {
    beforeAll(async () => {
        spies = [
            spyOn(database, "getPlaybackState").mockImplementation(() => null),
            spyOn(database, "updatePlaybackState").mockImplementation(() => {}),
            spyOn(database, "areNotificationsEnabled").mockImplementation(() => true),
            spyOn(database, "saveMediaEvent").mockImplementation(() => true),
            spyOn(database, "getEventAlertConfig").mockImplementation(() => true)
        ];

        const webhooks = await import("../webhooks");
        handleRadarrWebhook = webhooks.handleRadarrWebhook;
        handleSonarrWebhook = webhooks.handleSonarrWebhook;
    });

    afterAll(() => {
        for (const s of spies) {
            if (s && s.mockRestore) s.mockRestore();
        }
    });
    const mockBotData = {
        api: {
            sendMessage: async (chatId: string, text: string, options: any) => ({ message_id: 1 }),
        },
    };

    const mockBot = mockBotData as unknown as Bot;
    const sendMessageSpy = spyOn(mockBotData.api, "sendMessage");

    process.env.WEBHOOK_NOTIFY_CHAT_ID = "12345";
    process.env.ALLOWED_USER_IDS = "12345";

    it("should process Radarr Grab event and send a message", async () => {
        const payload = {
            eventType: "Grab",
            movie: { title: "Inception", year: 2010 },
            release: { quality: "1080p", releaseTitle: "Inception.2010.1080p.BluRay-x264" },
            downloadClient: "qBittorrent"
        };

        const request = new Request("http://localhost/radarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleRadarrWebhook(request, mockBot);
        expect(response.status).toBe(200);
        expect(sendMessageSpy).toHaveBeenCalled();

        const [chatId, text] = (sendMessageSpy as any).mock.calls[0];
        expect(chatId).toBe("12345");
        expect(text).toContain("Grabbed *Inception (2010)*");
        expect(text).toContain("1080p");
    });

    it("should process Sonarr Download event and send a message", async () => {
        const payload = {
            eventType: "Download",
            series: { title: "The Office" },
            episodes: [{ seasonNumber: 1, episodeNumber: 1, title: "Pilot" }],
            release: { quality: "720p" }
        };

        const request = new Request("http://localhost/sonarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleSonarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const [chatId, text] = (sendMessageSpy as any).mock.calls[1];
        expect(chatId).toBe("12345");
        expect(text).toContain("Download complete for *The Office - S01E01*");
    });

    it("should process Radarr Download event with movieFile quality", async () => {
        const payload = {
            eventType: "Download",
            movie: { title: "The Sheep Detectives", year: 2026 },
            movieFile: {
                relativePath: "The.Sheep.Detectives.2026.1080p.mkv",
                path: "/movies/The Sheep Detectives (2026)/The.Sheep.Detectives.2026.1080p.mkv",
                quality: {
                    quality: {
                        id: 1,
                        name: "Bluray-1080p"
                    },
                    revision: { version: 1, real: true }
                }
            },
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/radarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleRadarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const [, text] = (sendMessageSpy as any).mock.calls[(sendMessageSpy as any).mock.calls.length - 1];
        expect(text).toContain("Download complete for *The Sheep Detectives (2026)*");
        expect(text).toContain("*Quality*: Bluray-1080p");
        expect(text).toContain("*Client*: NZBGet");
        expect(text).not.toContain("undefined");
    });

    it("should process Radarr Download event without movieFile/release quality and not output undefined", async () => {
        const payload = {
            eventType: "Download",
            movie: { title: "The Sheep Detectives", year: 2026 },
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/radarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleRadarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const [, text] = (sendMessageSpy as any).mock.calls[(sendMessageSpy as any).mock.calls.length - 1];
        expect(text).toContain("Download complete for *The Sheep Detectives (2026)*");
        expect(text).not.toContain("Quality");
        expect(text).not.toContain("undefined");
    });

    it("should process Sonarr Download event with episodeFile quality", async () => {
        const payload = {
            eventType: "Download",
            series: { title: "The Office" },
            episodes: [{ seasonNumber: 1, episodeNumber: 1, title: "Pilot" }],
            episodeFile: {
                relativePath: "Season 01/The.Office.S01E01.mkv",
                path: "/shows/The Office/Season 01/The.Office.S01E01.mkv",
                quality: {
                    quality: {
                        id: 1,
                        name: "WEBDL-1080p"
                    },
                    revision: { version: 1, real: true }
                }
            },
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/sonarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleSonarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const [, text] = (sendMessageSpy as any).mock.calls[(sendMessageSpy as any).mock.calls.length - 1];
        expect(text).toContain("Download complete for *The Office - S01E01*");
        expect(text).toContain("*Quality*: WEBDL-1080p");
        expect(text).toContain("*Client*: NZBGet");
        expect(text).not.toContain("undefined");
    });

    it("should process Sonarr Download event without episodeFile/release quality and not output undefined", async () => {
        const payload = {
            eventType: "Download",
            series: { title: "The Office" },
            episodes: [{ seasonNumber: 1, episodeNumber: 1, title: "Pilot" }],
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/sonarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleSonarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const [, text] = (sendMessageSpy as any).mock.calls[(sendMessageSpy as any).mock.calls.length - 1];
        expect(text).toContain("Download complete for *The Office - S01E01*");
        expect(text).not.toContain("Quality");
        expect(text).not.toContain("undefined");
    });

    it("should process Radarr Download event with string movieFile quality", async () => {
        const payload = {
            eventType: "Download",
            movie: { title: "Azumi 2: Death or Love", year: 2005 },
            movieFile: {
                relativePath: "Azumi.2.2005.1080p.mkv",
                path: "/movies/Azumi 2 (2005)/Azumi.2.2005.1080p.mkv",
                quality: "WEBDL-1080p"
            },
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/radarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleRadarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const [, text] = (sendMessageSpy as any).mock.calls[(sendMessageSpy as any).mock.calls.length - 1];
        expect(text).toContain("Download complete for *Azumi 2: Death or Love (2005)*");
        expect(text).toContain("*Quality*: WEBDL-1080p");
        expect(text).toContain("*Client*: NZBGet");
        expect(text).not.toContain("undefined");
    });

    it("should process Sonarr Download event with string episodeFile quality", async () => {
        const payload = {
            eventType: "Download",
            series: { title: "The Office" },
            episodes: [{ seasonNumber: 1, episodeNumber: 1, title: "Pilot" }],
            episodeFile: {
                relativePath: "Season 01/The.Office.S01E01.mkv",
                path: "/shows/The Office/Season 01/The.Office.S01E01.mkv",
                quality: "HDTV-720p"
            },
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/sonarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleSonarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const [, text] = (sendMessageSpy as any).mock.calls[(sendMessageSpy as any).mock.calls.length - 1];
        expect(text).toContain("Download complete for *The Office - S01E01*");
        expect(text).toContain("*Quality*: HDTV-720p");
        expect(text).toContain("*Client*: NZBGet");
        expect(text).not.toContain("undefined");
    });

    it("should handle Radarr Webhook without movie object gracefully", async () => {
        const payload = {
            eventType: "Download",
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/radarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleRadarrWebhook(request, mockBot);
        expect(response.status).toBe(200);
    });


    it("should handle Sonarr Webhook without series object gracefully", async () => {
        const payload = {
            eventType: "Download",
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/sonarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleSonarrWebhook(request, mockBot);
        expect(response.status).toBe(200);
    });

    it("should extract quality name from nested object on Radarr Grab event", async () => {
        const payload = {
            eventType: "Grab",
            movie: { title: "Azumi 2: Death or Love", year: 2005 },
            release: {
                quality: {
                    quality: { id: 7, name: "Bluray-1080p" },
                    revision: { version: 1, real: 0 }
                },
                releaseTitle: "Azumi.2.2005.1080p.BluRay.mkv"
            },
            downloadClient: "NZBGet"
        };

        const request = new Request("http://localhost/radarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleRadarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const calls = (sendMessageSpy as any).mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[1]).toContain("Bluray-1080p");
        expect(lastCall[1]).not.toContain("undefined");
    });

    it("should extract quality name from nested object on Sonarr Grab event", async () => {
        const payload = {
            eventType: "Grab",
            series: { title: "Attack on Titan", tvdbId: 267440 },
            episodes: [{ seasonNumber: 4, episodeNumber: 1 }],
            release: {
                quality: {
                    quality: { id: 4, name: "HDTV-1080p" },
                    revision: { version: 1, real: 0 }
                },
                releaseTitle: "Attack.on.Titan.S04E01.1080p.mkv"
            },
            downloadClient: "qBittorrent"
        };

        const request = new Request("http://localhost/sonarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const response = await handleSonarrWebhook(request, mockBot);
        expect(response.status).toBe(200);

        const calls = (sendMessageSpy as any).mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[1]).toContain("HDTV-1080p");
        expect(lastCall[1]).not.toContain("undefined");
    });

    it("should not send duplicate notifications for duplicate Sonarr webhook events", async () => {
        const saveMediaEventMock = database.saveMediaEvent as any;
        saveMediaEventMock.mockImplementationOnce(() => true);
        saveMediaEventMock.mockImplementationOnce(() => false);

        const payload = {
            eventType: "Download",
            series: { title: "Deduplication Test" },
            episodes: [{ seasonNumber: 1, episodeNumber: 1, title: "Pilot" }],
            release: { quality: "720p" }
        };

        const req1 = new Request("http://localhost/sonarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });
        const req2 = new Request("http://localhost/sonarr-webhook", {
            method: "POST",
            body: JSON.stringify(payload),
        });

        const startCalls = sendMessageSpy.mock.calls.length;

        // Send first webhook (should notify)
        const res1 = await handleSonarrWebhook(req1, mockBot);
        expect(res1.status).toBe(200);

        // Send second webhook (should not notify)
        const res2 = await handleSonarrWebhook(req2, mockBot);
        expect(res2.status).toBe(200);

        const endCalls = sendMessageSpy.mock.calls.length;
        expect(endCalls - startCalls).toBe(1);
    });
});

