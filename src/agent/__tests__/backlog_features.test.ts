import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import * as ai from "ai";
import {
	addReportSubscription,
	getReportSubscriptions,
	removeReportSubscription,
} from "../../services/database";
import {
	notifySubscriptionChanged,
	registerSubscriptionChangedCallback,
} from "../../services/scheduler";

// Mock the Vercel AI SDK generateText function
process.env.GOOGLE_GENERATIVE_AI_API_KEY = "mock-api-key";

const spies: any[] = [];

beforeAll(() => {
	spies.push(
		spyOn(ai, "generateText").mockImplementation(async (options: any) => {
			return {
				text: "transcribed test query",
			} as any;
		}),
	);
});

afterAll(() => {
	for (const spy of spies) {
		spy.mockRestore();
	}
});

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
