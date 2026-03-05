import { describe, expect, it, spyOn, mock } from "bun:test";
import { handleRadarrWebhook, handleSonarrWebhook } from "../webhooks";
import { Bot } from "grammy";

mock.module("../database", () => ({
    getPlaybackState: () => null,
    updatePlaybackState: () => { },
    areNotificationsEnabled: () => true,
    saveMediaEvent: mock(() => { }),
    getEventAlertConfig: mock(() => true)
}));

describe("Radarr/Sonarr Webhook Notifications", () => {
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
});
