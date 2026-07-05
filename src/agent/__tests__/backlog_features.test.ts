import { describe, expect, it, mock, afterEach } from "bun:test";
import { addReportSubscription, getReportSubscriptions, removeReportSubscription } from "../../services/database";
import { registerSubscriptionChangedCallback, notifySubscriptionChanged } from "../../services/scheduler";

// Mock the Vercel AI SDK generateText function
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-api-key";

mock.module("ai", () => ({
  generateText: async (options: any) => {
    // Return dummy transcription response for tests
    return {
      text: "transcribed test query"
    };
  }
}));

describe("Voice Message Transcription & Scheduling tests", () => {
  it("should perform SQLite CRUD for report subscriptions", () => {
    const userId = 1234567;
    const initialList = getReportSubscriptions(userId);
    expect(initialList.length).toBe(0);

    const subId = addReportSubscription(userId, "summary", "0 9 * * *", 1);
    expect(typeof subId).toBe("number");

    const listAfterAdd = getReportSubscriptions(userId);
    expect(listAfterAdd.length).toBe(1);
    expect(listAfterAdd[0].report_type).toBe("summary");
    expect(listAfterAdd[0].cron_expression).toBe("0 9 * * *");
    expect(listAfterAdd[0].days).toBe(1);

    removeReportSubscription(subId);
    const listAfterDelete = getReportSubscriptions(userId);
    expect(listAfterDelete.length).toBe(0);
  });

  it("should trigger subscription change callback on notify", () => {
    let triggered = false;
    registerSubscriptionChangedCallback(() => {
      triggered = true;
    });

    notifySubscriptionChanged();
    expect(triggered).toBe(true);
  });

  it("should mock transcribeAudio successfully", async () => {
    const { transcribeAudio } = await import("../../services/transcription");
    const dummyBuffer = new ArrayBuffer(8);
    const transcription = await transcribeAudio(dummyBuffer, "audio/ogg");
    expect(transcription).toBe("transcribed test query");
  });
});
