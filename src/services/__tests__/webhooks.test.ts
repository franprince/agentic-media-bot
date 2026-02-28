import { expect, test, describe, spyOn, beforeEach, mock } from "bun:test";
import { handlePlexWebhook, isNonLatinTitle, withEnglishTitle } from "../webhooks";
import * as database from "../database";
import { Bot, InputFile } from "grammy";

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

        // Mock global fetch for image download
        global.fetch = mock((url: string) => {
            if (url.includes("/thumb.jpg")) {
                return Promise.resolve(new Response(new ArrayBuffer(8), {
                    status: 200,
                    statusText: "OK",
                    headers: { "Content-Type": "image/jpeg" }
                }));
            }
            return Promise.resolve(new Response(null, { status: 404 }));
        }) as any;
    });

    test("should NOT notify on library.new movie event but should clear cache", async () => {
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
        const sendMessageSpy = spyOn(mockBot.api, "sendMessage");
        const clearCacheSpy = spyOn(require("../../agent/tools"), "clearCache");

        const response = await handlePlexWebhook(request, mockBot as any);

        expect(response.status).toBe(200);
        expect(sendPhotoSpy).not.toHaveBeenCalled();
        expect(sendMessageSpy).not.toHaveBeenCalled();
        expect(clearCacheSpy).toHaveBeenCalled();
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
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "Inception",
                type: "movie",
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

    test("should include originalTitle in parentheses for non-Latin movie title (media.play)", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "千と千尋の神隠し",
                originalTitle: "Spirited Away",
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

        const response = await handlePlexWebhook(request, mockBot as any);

        expect(response.status).toBe(200);
        expect(sendMessageSpy).toHaveBeenCalled();
        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toContain("千と千尋の神隠し");
        expect(args[1]).toContain("Spirited Away");
        expect(args[1]).toContain("(Spirited Away)");
    });

    test("should include originalTitle in parentheses for non-Latin movie title (media.play)", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "기생충",
                originalTitle: "Parasite",
                type: "movie",
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
        expect(args[1]).toContain("기생충");
        expect(args[1]).toContain("(Parasite)");
    });

    test("should include originalTitle in parentheses for non-Latin movie title (media.scrobble)", async () => {
        const payload = {
            event: "media.scrobble",
            Account: { title: "Fran" },
            Metadata: {
                title: "七武士",
                originalTitle: "Seven Samurai",
                type: "movie",
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
        expect(args[1]).toContain("七武士");
        expect(args[1]).toContain("(Seven Samurai)");
    });

    test("should not append originalTitle when title is already Latin", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "Inception",
                originalTitle: "Inception",
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

        const response = await handlePlexWebhook(request, mockBot as any);

        expect(response.status).toBe(200);
        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        // Should not have duplicate title in parentheses
        expect(args[1]).not.toContain("(Inception)");
        expect(args[1]).toContain("Inception");
    });

    test("should not append originalTitle when it is absent", async () => {
        const payload = {
            event: "media.play",
            Account: { title: "Fran" },
            Metadata: {
                title: "Amélie",
                type: "movie",
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
        const args = sendMessageSpy.mock.calls[0];
        if (!args) throw new Error("sendMessage was not called");
        expect(args[1]).toContain("Amélie");
        expect(args[1]).not.toContain("(");
    });
});

describe("isNonLatinTitle", () => {
    test("returns false for plain ASCII titles", () => {
        expect(isNonLatinTitle("Inception")).toBe(false);
        expect(isNonLatinTitle("The Dark Knight")).toBe(false);
    });

    test("returns false for Latin-extended characters (accents, diacritics)", () => {
        expect(isNonLatinTitle("Amélie")).toBe(false);
        expect(isNonLatinTitle("El laberinto del fauno")).toBe(false);
        expect(isNonLatinTitle("Über den Wolken")).toBe(false);
    });

    test("returns true for Japanese titles", () => {
        expect(isNonLatinTitle("千と千尋の神隠し")).toBe(true);
        expect(isNonLatinTitle("七武士")).toBe(true);
    });

    test("returns true for Korean titles", () => {
        expect(isNonLatinTitle("기생충")).toBe(true);
    });

    test("returns true for Chinese titles", () => {
        expect(isNonLatinTitle("卧虎藏龙")).toBe(true);
    });

    test("returns true for Arabic titles", () => {
        expect(isNonLatinTitle("الرسالة")).toBe(true);
    });

    test("returns false for empty string", () => {
        expect(isNonLatinTitle("")).toBe(false);
    });
});

describe("withEnglishTitle", () => {
    test("returns displayedTitle unchanged when originalTitle is undefined", () => {
        expect(withEnglishTitle("Inception", undefined)).toBe("Inception");
    });

    test("returns displayedTitle unchanged when originalTitle equals displayedTitle", () => {
        expect(withEnglishTitle("Inception", "Inception")).toBe("Inception");
    });

    test("appends originalTitle in parentheses when both titles are Latin and differ", () => {
        // Now it SHOULD append even if both are Latin, as per user request
        expect(withEnglishTitle("El Laberinto del Fauno", "Pan's Labyrinth")).toBe("El Laberinto del Fauno (Pan's Labyrinth)");
    });

    test("appends originalTitle in parentheses when displayedTitle is non-Latin", () => {
        expect(withEnglishTitle("千と千尋の神隠し", "Spirited Away")).toBe("千と千尋の神隠し (Spirited Away)");
    });

    test("appends originalTitle in parentheses when originalTitle is non-Latin", () => {
        // Edge case: displayed title is Latin but originalTitle is non-Latin
        expect(withEnglishTitle("Spirited Away", "千と千尋の神隠し")).toBe("Spirited Away (千と千尋の神隠し)");
    });

    test("appends Korean originalTitle correctly", () => {
        expect(withEnglishTitle("기생충", "Parasite")).toBe("기생충 (Parasite)");
    });

    test("appends Chinese originalTitle correctly", () => {
        expect(withEnglishTitle("卧虎藏龙", "Crouching Tiger, Hidden Dragon")).toBe("卧虎藏龙 (Crouching Tiger, Hidden Dragon)");
    });
});
