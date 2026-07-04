import { expect, test, describe, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { handlePlexWebhook } from "../webhooks";
import * as database from "../database";
import * as plex from "../plex";
import * as radarr from "../radarr";
import { Bot } from "grammy";

describe("Plex Webhook Notifications V2", () => {
    let mockBot: any;
    let spies: any[] = [];

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
        spies = [
            spyOn(database, "areNotificationsEnabled").mockImplementation(() => true),
            spyOn(database, "saveMediaEvent").mockImplementation(() => true),
        ];
    });

    afterEach(() => {
        for (const s of spies) {
            if (s && s.mockRestore) s.mockRestore();
        }
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
        expect(args[1]).toBe("🎬 *Fran* started watching the movie *Inception*");
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
        expect(args[1]).toBe("🎬 *Fran* started watching an episode of *The Bear - S01E05 - The Bear*");
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
        expect(args[1]).toBe("🎬 *Fran* started watching the movie *Princess Mononoke (Mononoke-hime)*");
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
        expect(args[1]).toBe("🎬 *franp21* started watching the movie *もののけ姫 (Princess Mononoke)*");
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
        expect(args[1]).toBe("▶️ *Fran* resumed watching the movie *Inception*");
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
        expect(args[1]).toBe("✅ *Fran* finished watching the movie *Inception*");
    });

    test("should enrich metadata from Plex API if originalTitle is missing in payload", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "장화, 홍련",
                type: "movie",
                librarySectionType: "movie",
                ratingKey: "36"
            }
        };

        // Mock Plex API to return the English title
        const getItemMetadataSpy = spyOn(plex, "getItemMetadata").mockImplementation(async (ratingKey) => {
            if (ratingKey === "36") {
                return { originalTitle: "A Tale of Two Sisters" };
            }
            return undefined;
        });

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

        // Should have "A Tale of Two Sisters" in parentheses because it was enriched
        expect(args[1]).toBe("🎬 *Fran* started watching the movie *장화, 홍련 (A Tale of Two Sisters)*");
        expect(getItemMetadataSpy).toHaveBeenCalledWith("36");
    });

    test("should enrich metadata from Radarr if Plex enrichment fails for non-Latin titles", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "franp21" },
            Metadata: {
                title: "ハウルの動く城",
                type: "movie",
                librarySectionType: "movie",
                ratingKey: "4644",
                year: 2004
            }
        };

        // Mock Plex API to return NO originalTitle
        spyOn(plex, "getItemMetadata").mockImplementation(async () => ({}));

        // Mock Radarr API to return the English title
        const searchMovieSpy = spyOn(radarr, "searchMovie").mockImplementation(async (term) => {
            if (term === "ハウルの動く城") {
                return [{ title: "Howl's Moving Castle", originalTitle: "ハウルの動く城", year: 2004 }] as any;
            }
            return [];
        });

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

        // Should have "Howl's Moving Castle" in parentheses because it was enriched via Radarr
        expect(args[1]).toBe("🎬 *franp21* started watching the movie *ハウルの動く城 (Howl's Moving Castle)*");
        expect(searchMovieSpy).toHaveBeenCalledWith("ハウルの動く城");
    });

    test("should skip notification if alert for event type is disabled in database", async () => {
        database.setEventAlertConfig("plex", "media.play", false);

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

        expect(sendMessageSpy).not.toHaveBeenCalled();
    });

    test("should send notification if alert for event type is enabled in database", async () => {
        database.setEventAlertConfig("plex", "media.play", true);

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

        expect(sendMessageSpy).toHaveBeenCalled();
    });
});
