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

	it("should translate confirmation buttons to Spanish and filter out proactive notifications buttons when confirmation is required", async () => {
		const userId = 12345;
		mockHistoryVal = [];

		// Mock first pass where search results are presented
		mockGenerateText.mockResolvedValueOnce({
			text: "Buscando 'Leviticus' en Radarr...",
			toolCalls: [
				{
					toolName: "addMovie",
					toolCallId: "call_add_1",
					args: { tmdbId: 1012306, title: "Leviticus", year: 2026, confirm: false },
				},
			],
			toolResults: [
				{
					toolName: "addMovie",
					toolCallId: "call_add_1",
					result: {
						confirmationRequired: true,
						message: "I found Leviticus (2026). Please confirm:",
						buttons: [
							{ text: "✅ Yes, Add Movie", data: "add movie 1012306 1" },
							{ text: "❌ Cancel", data: "cancel add movie" },
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
								toolName: "addMovie",
								result: {
									confirmationRequired: true,
									buttons: [
										{ text: "✅ Yes, Add Movie", data: "add movie 1012306 1" },
										{ text: "❌ Cancel", data: "cancel add movie" },
									],
								},
							},
						],
					},
				],
			},
		});

		// Mock the synthesis model response where it falsely claims success and generates notification buttons
		mockGenerateText.mockResolvedValueOnce({
			text: "¡Listo! 'Leviticus' (2026) se ha añadido a Radarr. ¿Te gustaría que te notifique?\n\nBUTTON: Sí, notifícame! | notify_download_confirm_movie_1012306\nBUTTON: No, gracias | notify_download_decline",
			toolResults: [],
			response: {
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "text",
								text: "¡Listo! 'Leviticus' (2026) se ha añadido a Radarr. ¿Te gustaría que te notifique?\n\nBUTTON: Sí, notifícame! | notify_download_confirm_movie_1012306\nBUTTON: No, gracias | notify_download_decline",
							},
						],
					},
				],
			},
		});

		const result = await processUserMessage(
			userId,
			"Añadir Leviticus (2026)",
		);

		// Verification:
		// 1. Tool buttons must be translated to Spanish.
		// 2. Proactive notification buttons must be filtered out because confirmation is required.
		expect(result.buttons).toBeDefined();
		expect(result.buttons).toHaveLength(2);
		expect(result.buttons![0].text).toBe("✅ Sí, añadir película");
		expect(result.buttons![0].data).toBe("add movie 1012306 1");
		expect(result.buttons![1].text).toBe("❌ Cancelar");
		expect(result.buttons![1].data).toBe("cancel add movie");
	});

	it("should preserve callback data when language rewrite is triggered", () => {
		const { buildLanguageRewritePrompt } = require("../utils");
		const promptEs = buildLanguageRewritePrompt("es");
		expect(promptEs.toLowerCase()).toContain("do not translate or modify the callback_data");
		const promptEn = buildLanguageRewritePrompt("en");
		expect(promptEn.toLowerCase()).toContain("do not translate or modify the callback_data");
	});
});

