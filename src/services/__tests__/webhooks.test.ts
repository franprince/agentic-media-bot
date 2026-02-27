import { expect, test, describe, spyOn, beforeEach } from "bun:test";
import { handlePlexWebhook } from "../webhooks";
import * as database from "../database";
import { Bot } from "grammy";

describe("Plex Webhooks", () => {
    let mockBot: any;

    beforeEach(() => {
        mockBot = {
            api: {
                sendPhoto: async () => { },
                sendMessage: async () => { },
            }
        };
        process.env.ALLOWED_USER_IDS = "12345";
        process.env.WEBHOOK_NOTIFY_CHAT_ID = "12345";
        process.env.PLEX_URL = "http://plex.local";
        process.env.PLEX_TOKEN = "token123";
        // Reset notification state
        spyOn(database, "areNotificationsEnabled").mockImplementation(() => true);
    });

    test("should parse library.new movie event", async () => {
        const payload = {
            event: "library.new",
            Metadata: {
                title: "Inception",
                type: "movie",
                librarySectionType: "movie",
                thumb: "/thumb.jpg"
            }
        };

        const formData = new FormData();
        formData.append("payload", JSON.stringify(payload));

        const request = new Request("http://localhost/plex-webhook", {
            method: "POST",
            body: formData,
        });

        const sendPhotoSpy = spyOn(mockBot.api, "sendPhoto");

        const response = await handlePlexWebhook(request, mockBot as any);

        expect(response.status).toBe(200);
        expect(sendPhotoSpy).toHaveBeenCalled();
        const args = sendPhotoSpy.mock.calls[0];
        if (!args) throw new Error("sendPhoto was not called");
        expect(args[1]).toBe("http://plex.local/thumb.jpg?X-Plex-Token=token123");
        expect((args[2] as any).caption).toContain("Inception");
        expect((args[2] as any).caption).toContain("New Movie added");
    });

    test("should parse media.play episode event", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "The Bear",
                type: "episode",
                grandparentTitle: "The Bear",
                parentIndex: 1,
                index: 1
            }
        };

        const formData = new FormData();
        formData.append("payload", JSON.stringify(payload));

        const request = new Request("http://localhost/plex-webhook", {
            method: "POST",
            body: formData,
        });

        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");

        const response = await handlePlexWebhook(request, mockBot as any);

        expect(response.status).toBe(200);
        expect(sendMessageSpy).toHaveBeenCalled();
        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toContain("Fran* started watching");
        expect(args[1]).toContain("The Bear");
    });

    test("should return 400 if payload is missing", async () => {
        const request = new Request("http://localhost/plex-webhook", {
            method: "POST",
            body: new FormData(),
        });

        const response = await handlePlexWebhook(request, mockBot as any);
        expect(response.status).toBe(400);
    });

    test("should skip notification if disabled in database", async () => {
        spyOn(database, "areNotificationsEnabled").mockImplementation(() => false);

        const payload = {
            event: "library.new",
            Metadata: {
                title: "Inception",
                type: "movie",
                librarySectionType: "movie",
            }
        };

        const formData = new FormData();
        formData.append("payload", JSON.stringify(payload));

        const request = new Request("http://localhost/plex-webhook", {
            method: "POST",
            body: formData,
        });

        const sendPhotoSpy = spyOn(mockBot.api, "sendPhoto");
        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");

        const response = await handlePlexWebhook(request, mockBot as any);

        expect(response.status).toBe(200);
        const text = await response.text();
        expect(text).toBe("Notifications disabled");
        expect(sendPhotoSpy).not.toHaveBeenCalled();
        expect(sendMessageSpy).not.toHaveBeenCalled();
    });
});
