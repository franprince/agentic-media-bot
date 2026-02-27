import { expect, test, describe, spyOn, beforeEach, mock } from "bun:test";
import { handlePlexWebhook } from "../webhooks";
import * as database from "../database";
import { Bot } from "grammy";

describe("Plex Webhook Notifications V2", () => {
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
        spyOn(database, "areNotificationsEnabled").mockImplementation(() => true);
    });

    test("should use the new movie format: The user {user} started watching the movie {title}", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
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

        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");
        await handlePlexWebhook(request, mockBot as any);

        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toBe("🎬 *Fran* started watching the movie:\n*Inception*");
    });

    test("should use the new series format: The user {user} started watching an episode of {Series - SxxExx - Title}", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "The Bear",
                type: "episode",
                librarySectionType: "show",
                grandparentTitle: "The Bear",
                parentIndex: 1,
                index: 5
            }
        };

        const formData = new FormData();
        formData.append("payload", JSON.stringify(payload));

        const request = new Request("http://localhost/plex-webhook", {
            method: "POST",
            body: formData,
        });

        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");
        await handlePlexWebhook(request, mockBot as any);

        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toBe("🎬 *Fran* started watching an episode of:\n*The Bear - S01E05 - The Bear*");
    });

    test("should include originalTitle in parentheses if it differs from title (Latin cases)", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "Princess Mononoke",
                originalTitle: "Mononoke-hime",
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

        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");
        await handlePlexWebhook(request, mockBot as any);

        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toBe("🎬 *Fran* started watching the movie:\n*Princess Mononoke (Mononoke-hime)*");
    });

    test("should include originalTitle in parentheses if it differs from title (Non-Latin cases)", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "franp21" },
            Metadata: {
                title: "もののけ姫",
                originalTitle: "Princess Mononoke",
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

        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");
        await handlePlexWebhook(request, mockBot as any);

        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toBe("🎬 *franp21* started watching the movie:\n*もののけ姫 (Princess Mononoke)*");
    });

    test("should work for resumed events with the same template", async () => {
        const payload = {
            event: "media.resume",
            Account: { title: "Fran" },
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

        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");
        await handlePlexWebhook(request, mockBot as any);

        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toBe("▶️ *Fran* resumed watching the movie:\n*Inception*");
    });

    test("should work for scrobble (finished) events with the same template", async () => {
        const payload = {
            event: "media.scrobble",
            Account: { title: "Fran" },
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

        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");
        await handlePlexWebhook(request, mockBot as any);

        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toBe("✅ *Fran* finished watching the movie:\n*Inception*");
    });
});
