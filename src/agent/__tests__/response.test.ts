import { describe, expect, test } from "bun:test";
import {
	buildExactCountPrefix,
	buildPlexBrowseAuthoritativeText,
	extractToolResultsFromMessages,
	selectReplyButtons,
} from "../response";

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
