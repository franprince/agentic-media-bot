import { describe, expect, test, mock, beforeAll, afterEach } from "bun:test";
import { extractYearRange, discoverMedia } from "../tmdb";
import { HttpResponse, http } from "msw";
import { server } from "../../mocks/server";

let mockGenerateObjectResponse: any = {
	recommendations: []
};
let lastPrompt = "";

// Mock generateObject from the 'ai' package
mock.module("ai", () => {
	return {
		generateObject: async (options: any) => {
			lastPrompt = options.prompt;
			return {
				object: mockGenerateObjectResponse,
			};
		},
	};
});

describe("TMDB Service — extractYearRange", () => {
	test("should parse year ranges correctly", () => {
		const result = extractYearRange("comedy movies 2016-2026");
		expect(result).toEqual({ gte: "2016-01-01", lte: "2026-12-31" });
	});

	test("should parse year ranges with 'to' correctly", () => {
		const result = extractYearRange("comedy movies from 2018 to 2024");
		expect(result).toEqual({ gte: "2018-01-01", lte: "2024-12-31" });
	});

	test("should parse relative ranges like 'last X years' correctly", () => {
		const result = extractYearRange("comedias de los últimos 10 años");
		const thisYear = new Date().getFullYear();
		expect(result).toEqual({
			gte: `${thisYear - 10}-01-01`,
			lte: `${thisYear}-12-31`,
		});
	});

	test("should parse relative ranges with 'last X years' in English correctly", () => {
		const result = extractYearRange("movies from last 5 years");
		const thisYear = new Date().getFullYear();
		expect(result).toEqual({
			gte: `${thisYear - 5}-01-01`,
			lte: `${thisYear}-12-31`,
		});
	});

	test("should parse 'since/desde' queries correctly", () => {
		const result = extractYearRange("best series since 2020");
		expect(result).toEqual({ gte: "2020-01-01", lte: null });
	});

	test("should parse 'until/hasta' queries correctly", () => {
		const result = extractYearRange("movies until 2022");
		expect(result).toEqual({ gte: null, lte: "2022-12-31" });
	});

	test("should parse single year queries correctly", () => {
		const result = extractYearRange("action in 2025");
		expect(result).toEqual({ gte: "2025-01-01", lte: "2025-12-31" });
	});

	test("should return null for queries without year constraints", () => {
		const result = extractYearRange("funny movies");
		expect(result).toEqual({ gte: null, lte: null });
	});
});

describe("TMDB Service — discoverMedia constraints", () => {
	beforeAll(() => {
		process.env.TMDB_READ_ACCESS_TOKEN = "mock_token";
		
		server.use(
			http.get("*/genre/movie/list", () => {
				return HttpResponse.json({ genres: [{ id: 35, name: "Comedy" }] });
			}),
			http.get("*/genre/tv/list", () => {
				return HttpResponse.json({ genres: [{ id: 35, name: "Comedy" }] });
			}),
			http.get("*/search/movie", ({ request }) => {
				const url = new URL(request.url);
				const query = url.searchParams.get("query");
				if (query === "Movie A") {
					return HttpResponse.json({
						results: [
							{
								id: 1,
								title: "Movie A",
								release_date: "2024-05-01",
								overview: "Overview A",
								vote_average: 8.2,
								vote_count: 600,
								genre_ids: [35],
							}
						]
					});
				}
				if (query === "Movie B") {
					return HttpResponse.json({
						results: [
							{
								id: 2,
								title: "Movie B",
								release_date: "2024-06-01",
								overview: "Overview B",
								vote_average: 7.8,
								vote_count: 200,
								genre_ids: [35],
							}
						]
					});
				}
				if (query === "Movie C") {
					return HttpResponse.json({
						results: [
							{
								id: 3,
								title: "Movie C",
								release_date: "2024-07-01",
								overview: "Overview C",
								vote_average: 7.2,
								vote_count: 200,
								genre_ids: [35],
							}
						]
					});
				}
				if (query === "Movie D") {
					return HttpResponse.json({
						results: [
							{
								id: 4,
								title: "Movie D",
								release_date: "2024-08-01",
								overview: "Overview D",
								vote_average: 8.5,
								vote_count: 30,
								genre_ids: [35],
							}
						]
					});
				}
				return HttpResponse.json({ results: [] });
			})
		);
	});

	afterEach(() => {
		server.resetHandlers();
	});

	test("should filter recommendations by vote count and rating and anchor to current year", async () => {
		mockGenerateObjectResponse = {
			recommendations: [
				{ title: "Movie A", year: 2024, mediaType: "movie", imdbRating: 8.0 },
				{ title: "Movie B", year: 2024, mediaType: "movie", imdbRating: 7.2 },
				{ title: "Movie C", year: 2024, mediaType: "movie", imdbRating: 6.0 },
				{ title: "Movie D", year: 2024, mediaType: "movie", imdbRating: 8.5 },
			]
		};

		const results = await discoverMedia("comedy movies from last 2 years", 10);

		// Movie A (600 votes, rating 8.2) -> Kept, no warning.
		// Movie B (200 votes, rating 7.8 >= 7.5) -> Kept with warning "Few votes".
		// Movie C (200 votes, rating 7.2 < 7.5) -> Discarded.
		// Movie D (30 votes < 50) -> Discarded.
		expect(results.length).toBe(2);

		const movieA = results.find(r => r.title === "Movie A");
		expect(movieA).toBeDefined();
		expect(movieA?.rating).toBe(8.2); // Uses actual TMDB rating
		expect(movieA?.warning).toBeUndefined();

		const movieB = results.find(r => r.title === "Movie B");
		expect(movieB).toBeDefined();
		expect(movieB?.rating).toBe(7.8); // Uses actual TMDB rating
		expect(movieB?.warning).toBe("Few votes");

		// Verify year instruction in LLM prompt contains current year (e.g. 2026) and range (2024-2026)
		const currentYear = new Date().getFullYear();
		expect(lastPrompt).toContain(`The current year is ${currentYear}.`);
		expect(lastPrompt).toContain(`Your recommendations MUST be released between ${currentYear - 2} and ${currentYear}`);
	});
});
