import { describe, expect, test } from "bun:test";
import {
	buildExactCountPrefix,
	buildPlexBrowseAuthoritativeText,
	extractToolResultsFromMessages,
	noToolReply,
	scrubMarker,
	scrubMarkerFromMessages,
	selectReplyButtons,
} from "../response";
import { detectStatusLanguage } from "../status";

describe("response helpers", () => {
	test("builds Spanish exact-count prefix for country/genre Plex tools", () => {
		const prefix = buildExactCountPrefix(
			[{ toolName: "findPlexByCountry", result: { totalFound: 14 } }],
			"es",
		);
		expect(prefix).toBe("Encontré 14 títulos en Plex.");
	});

	test("builds English exact-count prefix for country/genre Plex tools", () => {
		const prefix = buildExactCountPrefix(
			[{ toolName: "browsePlexByGenre", result: { totalFound: 8 } }],
			"en",
		);
		expect(prefix).toBe("I found 8 titles in Plex.");
	});

	test("returns undefined when no exact-count tool results exist", () => {
		const prefix = buildExactCountPrefix(
			[{ toolName: "searchMovie", result: [] }],
			"en",
		);
		expect(prefix).toBeUndefined();
	});

	test("extracts tool results from message parts", () => {
		const extracted = extractToolResultsFromMessages([
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolName: "findPlexByCountry",
						result: { totalFound: 14 },
					},
				],
			},
		]);

		expect(extracted.length).toBe(1);
		expect(extracted[0]?.toolName).toBe("findPlexByCountry");
		expect(extracted[0]?.result?.totalFound).toBe(14);
	});

	test("builds authoritative Spanish Plex browse text with exact count and sample list", () => {
		const text = buildPlexBrowseAuthoritativeText(
			[
				{
					toolName: "findPlexByCountry",
					result: {
						totalFound: 2,
						queryType: "country",
						searchParam: "Germany",
						sampleItems: [
							{ title: "Das Boot", year: 1981 },
							{ title: "M", year: 1931 },
						],
					},
				},
			],
			"es",
		);

		expect(text).toInclude("Encontré 2 títulos en Plex.");
		expect(text).toInclude("Esta es la lista de películas de Germany:");
		expect(text).toInclude("- Das Boot (1981)");
		expect(text).toInclude("- M (1931)");
	});

	test("uses custom list label when provided by tool result", () => {
		const text = buildPlexBrowseAuthoritativeText(
			[
				{
					toolName: "findPlexByCountry",
					result: {
						totalFound: 12,
						listLabel: "Top 10 by rating",
						sampleItems: [{ title: "Movie A", year: 2001 }],
					},
				},
			],
			"en",
		);

		expect(text).toInclude("I found 12 titles in Plex.");
		expect(text).toInclude("Top 10 by rating");
	});

	test("includes original title when main title has non-Latin characters", () => {
		const text = buildPlexBrowseAuthoritativeText(
			[
				{
					toolName: "findPlexByCountry",
					result: {
						totalFound: 1,
						sampleItems: [
							{
								title: "オーディション",
								originalTitle: "Audition",
								year: 1999,
							},
						],
					},
				},
			],
			"en",
		);

		expect(text).toInclude("- オーディション (Audition) (1999)");
	});

	test("includes original title when it differs from main title", () => {
		const text = buildPlexBrowseAuthoritativeText(
			[
				{
					toolName: "findPlexByCountry",
					result: {
						totalFound: 1,
						sampleItems: [
							{
								title: "Le Fabuleux Destin d'Amélie Poulain",
								originalTitle: "Amélie",
								year: 2001,
							},
						],
					},
				},
			],
			"en",
		);

		expect(text).toInclude(
			"- Le Fabuleux Destin d'Amélie Poulain (Amélie) (2001)",
		);
	});

	test("does not show original title when it's the same as main title", () => {
		const text = buildPlexBrowseAuthoritativeText(
			[
				{
					toolName: "findPlexByCountry",
					result: {
						totalFound: 1,
						sampleItems: [
							{
								title: "Perfect Days",
								originalTitle: "Perfect Days",
								year: 2023,
							},
						],
					},
				},
			],
			"en",
		);

		expect(text).toInclude("- Perfect Days (2023)");
		expect(text).not.toInclude("Perfect Days (Perfect Days)");
	});

	test("does not show original title when main title is English", () => {
		const text = buildPlexBrowseAuthoritativeText(
			[
				{
					toolName: "findPlexByCountry",
					result: {
						totalFound: 1,
						sampleItems: [
							{ title: "Inception", originalTitle: "Inception", year: 2010 },
						],
					},
				},
			],
			"en",
		);

		expect(text).toInclude("- Inception (2010)");
		expect(text).not.toInclude("Inception (Inception)");
	});
});

describe("selectReplyButtons", () => {
	const toolButtons = [
		{ text: "✅ Yes, Add Movie", data: "add movie 693134 4" },
		{ text: "❌ Cancel", data: "cancel add movie" },
	];

	test("keeps only the tool's buttons when a tool supplied them", () => {
		const model = [
			{ text: "Yes, add it!", data: "add_movie_confirm" },
			{ text: "No, thanks", data: "cancel_action" },
		];
		expect(selectReplyButtons(toolButtons, model, true)).toEqual(toolButtons);
	});

	test("uses the model's buttons when no tool supplied any", () => {
		const model = [
			{ text: "Movies", data: "drama_movies" },
			{ text: "Series", data: "drama_series" },
		];
		expect(selectReplyButtons(undefined, model, false)).toEqual(model);
	});

	test("drops notification buttons while a confirmation is pending", () => {
		const model = [
			{ text: "Yes, notify me!", data: "notify_download_confirm_movie_1" },
			{ text: "No, thanks", data: "notify_download_decline" },
			{ text: "Yes, add it!", data: "add_movie_confirm" },
		];
		expect(selectReplyButtons(undefined, model, true)).toEqual([
			{ text: "Yes, add it!", data: "add_movie_confirm" },
		]);
	});

	test("dedupes, drops empty buttons and fits callback data in 64 bytes", () => {
		const long = "á".repeat(40); // 80 bytes
		const result = selectReplyButtons(
			undefined,
			[
				{ text: "A", data: "same" },
				{ text: "B", data: "same" },
				{ text: " ", data: "x" },
				{ text: "C", data: long },
			],
			false,
		);
		expect(result?.map((b) => b.text)).toEqual(["A", "C"]);
		expect(new TextEncoder().encode(result![1]!.data).length).toBeLessThanOrEqual(64);
		expect(selectReplyButtons(undefined, [], false)).toBeUndefined();
	});
});

describe("the reply for a request no tool covers", () => {
	test("reads as its own language, so it never triggers a rewrite request", () => {
		expect(detectStatusLanguage(noToolReply("es"))).toBe("es");
		expect(detectStatusLanguage(noToolReply("en"))).toBe("en");
		expect(noToolReply("es")).not.toBe(noToolReply("en"));
	});
});

describe("scrubMarker", () => {
	test("removes the marker and treats leftover punctuation as empty", () => {
		expect(scrubMarker("NEED_MORE_TOOLS")).toBe("");
		expect(scrubMarker("NEED_MORE_TOOLS.")).toBe("");
		expect(scrubMarker(" `NEED_MORE_TOOLS` \n")).toBe("");
		expect(scrubMarker("NEED_MORE_TOOLS I cannot do that. NEED_MORE_TOOLS")).toBe("I cannot do that.");
		expect(scrubMarker("Hola Fran")).toBe("Hola Fran");
	});
});

describe("scrubMarkerFromMessages", () => {
	const toolCall = { type: "tool-call", toolCallId: "c1", toolName: "searchMovie", args: { term: "Dune" } };
	const toolResult = {
		role: "tool",
		content: [{ type: "tool-result", toolCallId: "c1", toolName: "searchMovie", result: { note: "NEED_MORE_TOOLS" } }],
	};

	test("replaces a marker-only reply with the fallback and leaves the input alone", () => {
		const messages: any[] = [{ role: "assistant", content: [{ type: "text", text: "NEED_MORE_TOOLS" }] }];
		const scrubbed = scrubMarkerFromMessages(messages, "No puedo.");
		expect(scrubbed).toEqual([{ role: "assistant", content: [{ type: "text", text: "No puedo." }] }]);
		expect(messages[0].content[0].text).toBe("NEED_MORE_TOOLS");
	});

	test("keeps tool calls and tool results, dropping only the emptied text", () => {
		const messages: any[] = [
			{ role: "assistant", content: [{ type: "text", text: "NEED_MORE_TOOLS" }, toolCall] },
			toolResult,
			{ role: "assistant", content: "Found Dune. NEED_MORE_TOOLS" },
		];
		expect(scrubMarkerFromMessages(messages, "")).toEqual([
			{ role: "assistant", content: [toolCall] },
			toolResult,
			{ role: "assistant", content: "Found Dune." },
		] as any);
	});

	test("returns messages without the marker unchanged, empty text parts included", () => {
		const messages: any[] = [
			{ role: "user", content: "NEED_MORE_TOOLS" },
			{ role: "assistant", content: [{ type: "text", text: "" }, toolCall] },
			toolResult,
		];
		expect(scrubMarkerFromMessages(messages, "fallback")).toEqual(messages);
	});

	test("gives the fallback to the final reply only, not to an earlier step", () => {
		const messages: any[] = [
			{ role: "assistant", content: [{ type: "text", text: "NEED_MORE_TOOLS" }, toolCall] },
			toolResult,
			{ role: "assistant", content: [{ type: "text", text: "NEED_MORE_TOOLS" }] },
		];
		expect(scrubMarkerFromMessages(messages, "No puedo.")).toEqual([
			{ role: "assistant", content: [toolCall] },
			toolResult,
			{ role: "assistant", content: [{ type: "text", text: "No puedo." }] },
		] as any);
	});

	test("drops an assistant message left with nothing when there is no fallback", () => {
		const messages: any[] = [{ role: "assistant", content: "NEED_MORE_TOOLS" }];
		expect(scrubMarkerFromMessages(messages, "")).toEqual([]);
	});
});
