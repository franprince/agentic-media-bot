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

	test("tops up a year the model did fill, without listing a title twice", async () => {
		process.env.TMDB_READ_ACCESS_TOKEN = "test-token";
		const currentYear = new Date().getFullYear();
		mockGenerateObjectResponse = {
			recommendations: [{ title: "Known Show", mediaType: "tv", imdbRating: 8 }],
		};
		const show = (id: number, name: string, votes = 900) => ({
			id,
			name,
			first_air_date: `${currentYear}-03-01`,
			overview: "A show.",
			vote_average: 8,
			vote_count: votes,
			genre_ids: [35],
		});
		const floors: string[] = [];
		server.use(
			http.get("https://api.themoviedb.org/3/genre/:type/list", () =>
				HttpResponse.json({ genres: [{ id: 35, name: "Comedy" }] }),
			),
			http.get("https://api.themoviedb.org/3/search/tv", () =>
				HttpResponse.json({ results: [show(1, "Known Show")] }),
			),
			http.get("https://api.themoviedb.org/3/discover/tv", ({ request }) => {
				const params = new URL(request.url).searchParams;
				floors.push(params.get("vote_count.gte") ?? "");
				const year = params.get("first_air_date.gte")?.slice(0, 4);
				return HttpResponse.json({
					results: year === String(currentYear) ? [show(1, "Known Show"), show(2, "Other Show", 240)] : [],
				});
			}),
		);

		const results = await discoverMedia(`comedy series ${currentYear}`, 10);

		expect(results.map((result) => result.title).sort()).toEqual(["Known Show", "Other Show"]);
		expect(floors).toEqual(["200"]);
		expect(results.find((result) => result.title === "Other Show")?.warning).toBe("Few votes");
		expect(results.find((result) => result.title === "Known Show")?.warning).toBeUndefined();
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

describe("TMDB Service — older periods", () => {
	const thisYear = new Date().getFullYear();

	afterEach(() => {
		server.resetHandlers();
	});

	test("reads 19xx years, decades and era words", () => {
		expect(extractYearRange("comedy movies 1960-1999")).toEqual({ gte: "1960-01-01", lte: "1999-12-31" });
		expect(extractYearRange("thrillers from 1975 to 1985")).toEqual({ gte: "1975-01-01", lte: "1985-12-31" });
		expect(extractYearRange("horror in 1982")).toEqual({ gte: "1982-01-01", lte: "1982-12-31" });
		expect(extractYearRange("80s action movies")).toEqual({ gte: "1980-01-01", lte: "1989-12-31" });
		expect(extractYearRange("comedies from the 1990s")).toEqual({ gte: "1990-01-01", lte: "1999-12-31" });
		expect(extractYearRange("peliculas de los años 70")).toEqual({ gte: "1970-01-01", lte: "1979-12-31" });
		expect(extractYearRange("2000s sci-fi series")).toEqual({ gte: "2000-01-01", lte: "2009-12-31" });
		for (const query of ["classic comedy movies", "comedias clásicas", "peliculas viejas de terror", "old westerns"]) {
			expect(extractYearRange(query)).toEqual({ gte: "1930-01-01", lte: `${thisYear - 25}-12-31` });
		}
		expect(extractYearRange("funny movies")).toEqual({ gte: null, lte: null });
		expect(extractYearRange("las 10 mejores comedias")).toEqual({ gte: null, lte: null });
		expect(extractYearRange("los 10 mejores thrillers")).toEqual({ gte: null, lte: null });
	});

	test("searches a span wider than six years in one TMDB request, with no model requests", async () => {
		process.env.TMDB_READ_ACCESS_TOKEN = "test-token";
		promptsSent = [];
		const requests: URLSearchParams[] = [];
		server.use(
			http.get("https://api.themoviedb.org/3/genre/:type/list", () =>
				HttpResponse.json({ genres: [{ id: 35, name: "Comedy" }] }),
			),
			http.get("https://api.themoviedb.org/3/discover/movie", ({ request }) => {
				requests.push(new URL(request.url).searchParams);
				return HttpResponse.json({
					total_results: 2,
					results: [
						{ id: 501, title: "The Office Party", release_date: "1961-04-01", overview: "A party.", vote_average: 8.2, vote_count: 2800, genre_ids: [35] },
						{ id: 502, title: "Rain Dance", release_date: "1953-02-01", overview: "Singing.", vote_average: 8.1, vote_count: 3700, genre_ids: [35] },
					],
				});
			}),
		);

		const results = await discoverMedia("classic comedy movies", 15);

		expect(promptsSent).toHaveLength(0);
		expect(requests).toHaveLength(1);
		expect(requests[0]?.get("primary_release_date.gte")).toBe("1930-01-01");
		expect(requests[0]?.get("primary_release_date.lte")).toBe(`${thisYear - 25}-12-31`);
		expect(requests[0]?.get("vote_count.gte")).toBe("1000");
		expect(requests[0]?.get("with_genres")).toBe("35");
		expect(results.map((r) => [r.title, r.year])).toEqual([["The Office Party", 1961], ["Rain Dance", 1953]]);
	});

	test("asks series for fewer votes than movies over a wide span", async () => {
		process.env.TMDB_READ_ACCESS_TOKEN = "test-token";
		const floors: string[] = [];
		server.use(
			http.get("https://api.themoviedb.org/3/genre/:type/list", () => HttpResponse.json({ genres: [] })),
			http.get("https://api.themoviedb.org/3/discover/tv", ({ request }) => {
				floors.push(new URL(request.url).searchParams.get("vote_count.gte") ?? "");
				return HttpResponse.json({ total_results: 0, results: [] });
			}),
		);

		await discoverMedia("sitcom series 1980-1999", 15);

		expect(floors).toEqual(["300"]);
	});
});
