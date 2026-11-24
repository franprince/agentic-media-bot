import { describe, expect, test, mock, beforeAll, afterEach } from "bun:test";
import { extractYearRange, discoverMedia } from "../tmdb";
import { HttpResponse, http } from "msw";
import { server } from "../../mocks/server";

let mockGenerateObjectResponse: any = {
	recommendations: []
};
let promptsSent: string[] = [];

// Mock generateObject from the 'ai' package
mock.module("ai", () => {
	return {
		generateObject: async (options: any) => {
			promptsSent.push(options.prompt);
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
			// Years the model leaves empty fall back to TMDB discover; keep that
			// off the real network.
			http.get("*/discover/:type", () => {
				return HttpResponse.json({ results: [], total_results: 0 });
			}),
			http.get("*/search/movie", ({ request }) => {
				const url = new URL(request.url);
				const query = url.searchParams.get("query");
				const yearParam = url.searchParams.get("primary_release_year");
				
				// Only return mocked movies for the year 2024 to simulate empty results for other years
				if (yearParam !== "2024") {
					return HttpResponse.json({ results: [] });
				}

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
		promptsSent = [];
		mockGenerateObjectResponse = {
			recommendations: [
				{ title: "Movie A", mediaType: "movie", imdbRating: 8.0 },
				{ title: "Movie B", mediaType: "movie", imdbRating: 7.2 },
				{ title: "Movie C", mediaType: "movie", imdbRating: 6.0 },
				{ title: "Movie D", mediaType: "movie", imdbRating: 8.5 },
			]
		};

		const results = await discoverMedia("comedy movies from last 2 years", 10);

		// The test range is last 2 years, meaning 3 years (e.g. 2026, 2025, 2024).
		// We expect 3 parallel queries.
		// For each year, we only mock TMDB search returning movies if year is 2024.
		// Movie A (600 votes, rating 8.2) -> Kept.
		// Movie B (200 votes, rating 7.8 >= 7.5) -> Kept with warning.
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

		// Verify year instruction prompts contain each specific year
		const currentYear = new Date().getFullYear();
		expect(promptsSent.length).toBe(3);
		expect(promptsSent).toContain(
			`You are a movie and TV show recommendation assistant. Suggest a list of up to 3 highly-rated and popular movies released specifically in the year ${currentYear} that match the following criteria: "comedy movies from last 2 years".\n\nCRITICAL: Your recommendations MUST have been released in the year ${currentYear}. Only suggest well-known titles that have a large number of votes (at least 500+ votes) or highly-rated niche titles (7.5+ rating with 50+ votes). Avoid suggesting completely obscure titles.\n\nIf you do not know enough titles from ${currentYear} (for example a year after your training data), return {"recommendations": []} instead of explaining — the caller fills that year from TMDB. Always reply with the JSON object only.`
		);
		expect(promptsSent).toContain(
			`You are a movie and TV show recommendation assistant. Suggest a list of up to 3 highly-rated and popular movies released specifically in the year ${currentYear - 2} that match the following criteria: "comedy movies from last 2 years".\n\nCRITICAL: Your recommendations MUST have been released in the year ${currentYear - 2}. Only suggest well-known titles that have a large number of votes (at least 500+ votes) or highly-rated niche titles (7.5+ rating with 50+ votes). Avoid suggesting completely obscure titles.\n\nIf you do not know enough titles from ${currentYear - 2} (for example a year after your training data), return {"recommendations": []} instead of explaining — the caller fills that year from TMDB. Always reply with the JSON object only.`
		);
	});
});

describe("TMDB Service — discoverMedia TMDB fallback", () => {
	afterEach(() => {
		server.resetHandlers();
	});

	test("fills years the model returned nothing for from TMDB discover", async () => {
		process.env.TMDB_READ_ACCESS_TOKEN = "test-token";
		mockGenerateObjectResponse = { recommendations: [] };
		const yearsRequested: string[] = [];
		server.use(
			http.get("https://api.themoviedb.org/3/genre/:type/list", () =>
				HttpResponse.json({ genres: [{ id: 27, name: "Horror" }] }),
			),
			http.get("https://api.themoviedb.org/3/discover/movie", ({ request }) => {
				const url = new URL(request.url);
				const year = (url.searchParams.get("primary_release_date.gte") ?? "").slice(0, 4);
				yearsRequested.push(year);
				expect(url.searchParams.get("with_genres")).toBe("27");
				expect(url.searchParams.get("vote_count.gte")).toBe("500");
				return HttpResponse.json({
					total_results: 1,
					results: [
						{
							id: Number(year),
							title: `Horror of ${year}`,
							release_date: `${year}-06-01`,
							overview: "Scary.",
							vote_average: 7.44,
							vote_count: 900,
							genre_ids: [27],
							poster_path: "/p.jpg",
						},
					],
				});
			}),
		);

		const results = await discoverMedia("horror movies", 10);

		const currentYear = new Date().getFullYear();
		expect(yearsRequested.sort()).toEqual(
			[currentYear - 2, currentYear - 1, currentYear].map(String),
		);
		expect(results.length).toBe(3);
		expect(results[0]).toMatchObject({
			mediaType: "movie",
			rating: 7.4,
			voteCount: 900,
			genres: ["Horror"],
			posterPath: "/p.jpg",
		});
	});
});
