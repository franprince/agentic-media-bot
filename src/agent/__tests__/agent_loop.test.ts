import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as ai from "ai";
import * as database from "../../services/database";
import * as plex from "../../services/plex";
import { processUserMessage } from "../index";

// Mock data
let mockHistoryVal: any[] = [];
const mockGenerateText = mock();
const spies: any[] = [];

beforeAll(() => {
	spies.push(
		spyOn(database, "getHistory").mockImplementation(() => mockHistoryVal),
	);
	spies.push(
		spyOn(database, "saveHistory").mockImplementation(
			(userId: number, history: any[]) => {
				mockHistoryVal = history;
			},
		),
	);
	spies.push(spyOn(database, "getUserName").mockImplementation(() => "Fran"));
	spies.push(
		spyOn(database, "savePendingNotification").mockImplementation(() => {}),
	);

	spies.push(
		spyOn(plex, "normalizeCountryName").mockImplementation((c: string) =>
			c.toLowerCase() === "japanese" ? "japan" : c,
		),
	);

	spies.push(
		spyOn(ai, "generateText").mockImplementation(mockGenerateText as any),
	);
});

afterAll(() => {
	for (const spy of spies) {
		spy.mockRestore();
	}
});

describe("Agent E2E - Origin Search & Language", () => {
	beforeEach(() => {
		mockGenerateText.mockClear();
		mockHistoryVal = [];
		process.env.AI_PROVIDER = "google";
		process.env.AI_MODEL_FAST = "fast-model";
		process.env.AI_MODEL_CAPABLE = "capable-model";
	});

	it("should use findPlexByCountry for 'Japanese series' and respond in English", async () => {
		const userId = 12345;
		// Step 1: Simulate LLM calling findPlexByCountry
		mockGenerateText.mockResolvedValueOnce({
			text: "Searching for Japanese series...",
			toolCalls: [
				{
					toolName: "findPlexByCountry",
					toolCallId: "call_123",
					args: { country: "Japan" },
				},
			],
			toolResults: [
				{
					toolName: "findPlexByCountry",
					toolCallId: "call_123",
					result: {
						totalFound: 2,
						queryType: "country",
						searchParam: "Japan",
						sampleItems: [
							{ title: "Shogun", year: 2024 },
							{ title: "Alice in Borderland", year: 2020 },
						],
					},
				},
			],
			response: {
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "..." }] },
					{
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolName: "findPlexByCountry",
								result: {
									totalFound: 2,
									queryType: "country",
									searchParam: "Japan",
									sampleItems: [
										{ title: "Shogun", year: 2024 },
										{ title: "Alice in Borderland", year: 2020 },
									],
								},
							},
						],
					},
				],
			},
		});

		// Mocking synthesized response
		mockGenerateText.mockResolvedValueOnce({
			text: "I found 2 titles in Plex.\n\nThis is the list of movies from Japan:\n- Shogun (2024)\n- Alice in Borderland (2020)",
			toolResults: [],
			response: {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "I found 2 titles in Plex..." }],
					},
				],
			},
		});

		const result = await processUserMessage(
			userId,
			"Do I have Japanese series?",
		);

		expect(result.text).toContain("I found 2 titles in Plex.");
		expect(result.text).toContain("Shogun (2024)");
		expect(result.text).toContain("This is the list of movies from Japan:");
	});

	it("should trigger language rewrite if LLM responds in Spanish to English user", async () => {
		const userId = 54321;
		// Mocking a flow where LLM ignores the system prompt and replies in Spanish
		mockGenerateText.mockResolvedValueOnce({
			text: "Sí, tienes series japonesas.",
			toolResults: [],
			response: {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "Sí, tienes series japonesas." }],
					},
				],
			},
		});

		// Mocking the rewrite call
		mockGenerateText.mockResolvedValueOnce({
			text: "Yes, you have Japanese series.",
			toolResults: [],
			response: {
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "Yes, you have Japanese series." }],
					},
				],
			},
		});

		const result = await processUserMessage(
			userId,
			"Do I have any Japanese series?",
		);

		expect(result.text).toBe("Yes, you have Japanese series.");
	});

	it("should handle notify_download_confirm callback message by calling subscribeToDownload tool", async () => {
		const userId = 12345;
		mockHistoryVal = [
			{
				role: "assistant",
				content: [
					{
						type: "text",
						text: '🎉 "Elle" (2026) has been added to Sonarr. Would you like me to notify you once it\'s finished downloading?',
					},
				],
			},
		];

		mockGenerateText.mockResolvedValueOnce({
			text: "Calling subscribeToDownload...",
			toolCalls: [
				{
					toolName: "subscribeToDownload",
					toolCallId: "call_sub_1",
					args: {
						userId: 12345,
						mediaType: "series",
						mediaId: 413380,
						title: "Elle",
					},
				},
			],
			toolResults: [
				{
					toolName: "subscribeToDownload",
					toolCallId: "call_sub_1",
					result: {
						success: true,
						message:
							"Perfect! I'll send you a Telegram message as soon as 'Elle' finishes downloading. 📡🎬",
					},
				},
			],
			response: {
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "..." }] },
					{
						role: "tool",
						content: [
							{
								type: "tool-result",
								toolName: "subscribeToDownload",
								result: {
									success: true,
									message:
										"Perfect! I'll send you a Telegram message as soon as 'Elle' finishes downloading. 📡🎬",
								},
							},
						],
					},
				],
			},
		});

		mockGenerateText.mockResolvedValueOnce({
			text: "Perfect! I'll send you a Telegram message as soon as 'Elle' finishes downloading. 📡🎬",
			toolResults: [],
			response: {
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "Perfect! I'll send you a Telegram message as soon as 'Elle' finishes downloading. 📡🎬",
							},
						],
					},
				],
			},
		});

		const result = await processUserMessage(
			userId,
			"notify_download_confirm_series_413380",
		);

		expect(result.text).toContain(
			"Perfect! I'll send you a Telegram message as soon as 'Elle' finishes downloading.",
		);
	});
});
