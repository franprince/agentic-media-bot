import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

/**
 * TMDB (The Movie Database) API service.
 * Uses the v3 REST API authenticated with the Read Access Token (Bearer auth).
 * Docs: https://developer.themoviedb.org/reference/intro/getting-started
 */

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

/** Genre name → TMDB genre ID mappings for movies and TV shows */
const MOVIE_GENRE_IDS: Record<string, number> = {
	action: 28,
	adventure: 12,
	animation: 16,
	comedy: 35,
	crime: 80,
	documentary: 99,
	drama: 18,
	family: 10751,
	fantasy: 14,
	history: 36,
	horror: 27,
	music: 10402,
	mystery: 9648,
	romance: 10749,
	"science fiction": 878,
	"sci-fi": 878,
	scifi: 878,
	thriller: 53,
	war: 10752,
	western: 37,
};

const TV_GENRE_IDS: Record<string, number> = {
	action: 10759,
	adventure: 10759,
	animation: 16,
	comedy: 35,
	crime: 80,
	documentary: 99,
	drama: 18,
	family: 10751,
	fantasy: 10765,
	history: 36,
	horror: 9648,
	kids: 10762,
	mystery: 9648,
	news: 10763,
	reality: 10764,
	"science fiction": 10765,
	"sci-fi": 10765,
	scifi: 10765,
	soap: 10766,
	talk: 10767,
	"war & politics": 10768,
	western: 37,
};

export interface TmdbResult {
	id: number;
	title: string;
	mediaType: "movie" | "tv";
	year: number | null;
	overview: string;
	rating: number;
	voteCount: number;
	genres: string[];
	posterPath: string | null;
}

interface YearRange {
	gte: string | null;
	lte: string | null;
}

/** Extract a year range from a free-text query string */
export function extractYearRange(query: string): YearRange {
	const rangeMatch = query.match(/(?:^|\s+)(20\d{2})\s*(?:-|to|a|y|until)\s*(20\d{2})(?:\s+|$)/i);
	if (rangeMatch) {
		const y1 = parseInt(rangeMatch[1]!, 10);
		const y2 = parseInt(rangeMatch[2]!, 10);
		const minYear = Math.min(y1, y2);
		const maxYear = Math.max(y1, y2);
		return {
			gte: `${minYear}-01-01`,
			lte: `${maxYear}-12-31`,
		};
	}

	const lastYearsMatch = query.match(/(?:^|\s+)(?:last|últimos|ultimos)\s+(\d{1,2})\s+(?:years|años)(?:\s+|$)/i);
	if (lastYearsMatch) {
		const years = parseInt(lastYearsMatch[1]!, 10);
		const thisYear = new Date().getFullYear();
		return {
			gte: `${thisYear - years}-01-01`,
			lte: `${thisYear}-12-31`,
		};
	}

	const sinceMatch = query.match(/(?:^|\s+)(?:since|desde)\s+(20\d{2})(?:\s+|$)/i);
	if (sinceMatch) {
		return {
			gte: `${sinceMatch[1]}-01-01`,
			lte: null,
		};
	}

	const untilMatch = query.match(/(?:^|\s+)(?:until|hasta)\s+(20\d{2})(?:\s+|$)/i);
	if (untilMatch) {
		return {
			gte: null,
			lte: `${untilMatch[1]}-12-31`,
		};
	}

	const singleMatch = query.match(/(?:^|\s+)(20\d{2})(?:\s+|$)/);
	if (singleMatch) {
		const year = singleMatch[1];
		return {
			gte: `${year}-01-01`,
			lte: `${year}-12-31`,
		};
	}

	return { gte: null, lte: null };
}

/** Determine whether the query is asking for movies, TV, or both */
function extractMediaType(query: string): "movie" | "tv" | "both" {
	const lower = query.toLowerCase();
	const tvKeywords = [
		"series",
		"show",
		"tv",
		"television",
		"season",
		"episode",
		"sitcom",
	];
	const movieKeywords = ["movie", "film", "cinema", "feature"];
	const hasTv = tvKeywords.some((k) => lower.includes(k));
	const hasMovie = movieKeywords.some((k) => lower.includes(k));
	if (hasTv && !hasMovie) return "tv";
	if (hasMovie && !hasTv) return "movie";
	return "both";
}

/** Extract matching genre IDs from the query for a given media type */
function extractGenreIds(query: string, type: "movie" | "tv"): number[] {
	const lower = query.toLowerCase();
	const map = type === "movie" ? MOVIE_GENRE_IDS : TV_GENRE_IDS;
	const found = new Set<number>();
	for (const [name, id] of Object.entries(map)) {
		if (lower.includes(name)) found.add(id);
	}
	return [...found];
}

function getAuthHeaders(): Record<string, string> {
	const token = process.env.TMDB_READ_ACCESS_TOKEN;
	const apiKey = process.env.TMDB_READ_API_KEY;

	if (token) {
		return {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		};
	}
	if (apiKey) {
		// Fallback: api_key is appended in the URL; return minimal headers
		return { "Content-Type": "application/json" };
	}
	throw new Error(
		"No TMDB credentials found. Set TMDB_READ_ACCESS_TOKEN or TMDB_READ_API_KEY.",
	);
}

function appendApiKey(url: string): string {
	const token = process.env.TMDB_READ_ACCESS_TOKEN;
	if (token) return url; // Bearer auth — no query param needed
	const apiKey = process.env.TMDB_READ_API_KEY;
	if (apiKey) {
		const sep = url.includes("?") ? "&" : "?";
		return `${url}${sep}api_key=${apiKey}`;
	}
	return url;
}

async function tmdbFetch<T>(
	path: string,
	params: Record<string, string | number> = {},
): Promise<T> {
	const searchParams = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		searchParams.set(k, String(v));
	}
	const queryString = searchParams.toString();
	const rawUrl = `${TMDB_BASE_URL}${path}${queryString ? `?${queryString}` : ""}`;
	const url = appendApiKey(rawUrl);

	const response = await fetch(url, { headers: getAuthHeaders() });
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`TMDB API error ${response.status}: ${text}`);
	}
	return response.json() as Promise<T>;
}

/** Build genre name lookup (id → name) from TMDB's genre list endpoint */
async function fetchGenreMap(
	type: "movie" | "tv",
): Promise<Record<number, string>> {
	try {
		const data = await tmdbFetch<{
			genres: Array<{ id: number; name: string }>;
		}>(`/genre/${type}/list`, { language: "en" });
		return Object.fromEntries(data.genres.map((g) => [g.id, g.name]));
	} catch {
		return {};
	}
}

interface TmdbDiscoverMovie {
	id: number;
	title: string;
	release_date?: string;
	overview: string;
	vote_average: number;
	vote_count: number;
	genre_ids: number[];
	poster_path?: string | null;
}

interface TmdbDiscoverTv {
	id: number;
	name: string;
	first_air_date?: string;
	overview: string;
	vote_average: number;
	vote_count: number;
	genre_ids: number[];
	poster_path?: string | null;
}

function parseYear(dateStr?: string): number | null {
	if (!dateStr) return null;
	const y = parseInt(dateStr.split("-")[0]!, 10);
	return isNaN(y) ? null : y;
}

/** Discover movies matching year/genre constraints */
async function discoverMovies(
	yearRange: YearRange,
	genreIds: number[],
	sortBy: string,
	voteCountGte: number,
	page = 1,
): Promise<{ results: TmdbDiscoverMovie[]; totalResults: number }> {
	const params: Record<string, string | number> = {
		language: "en-US",
		sort_by: sortBy,
		"vote_count.gte": voteCountGte,
		page,
	};
	if (yearRange.gte) {
		params["primary_release_date.gte"] = yearRange.gte;
	} else {
		// Default to last 2 years when no year specified
		const thisYear = new Date().getFullYear();
		params["primary_release_date.gte"] = `${thisYear - 1}-01-01`;
	}
	if (yearRange.lte) {
		params["primary_release_date.lte"] = yearRange.lte;
	}
	if (genreIds.length > 0) params["with_genres"] = genreIds.join(",");

	const data = await tmdbFetch<{
		results: TmdbDiscoverMovie[];
		total_results: number;
	}>("/discover/movie", params);
	return { results: data.results, totalResults: data.total_results };
}

/** Discover TV shows matching year/genre constraints */
async function discoverTv(
	yearRange: YearRange,
	genreIds: number[],
	sortBy: string,
	voteCountGte: number,
	page = 1,
): Promise<{ results: TmdbDiscoverTv[]; totalResults: number }> {
	const params: Record<string, string | number> = {
		language: "en-US",
		sort_by: sortBy,
		"vote_count.gte": voteCountGte,
		page,
	};
	if (yearRange.gte) {
		params["first_air_date.gte"] = yearRange.gte;
	} else {
		const thisYear = new Date().getFullYear();
		params["first_air_date.gte"] = `${thisYear - 1}-01-01`;
	}
	if (yearRange.lte) {
		params["first_air_date.lte"] = yearRange.lte;
	}
	if (genreIds.length > 0) params["with_genres"] = genreIds.join(",");

	const data = await tmdbFetch<{
		results: TmdbDiscoverTv[];
		total_results: number;
	}>("/discover/tv", params);
	return { results: data.results, totalResults: data.total_results };
}

function getCapableModel() {
	const ollamaBaseUrl = (
		process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
	).replace(/\/$/, "");
	const modelCapableName =
		process.env.AI_MODEL_CAPABLE || process.env.AI_MODEL || "minimax-m2.7:cloud";

	const ollamaProvider = createOpenAI({
		baseURL: `${ollamaBaseUrl}/v1`,
		apiKey: "ollama",
	});
	return ollamaProvider(modelCapableName);
}

async function searchTmdbMovie(
	title: string,
	year?: number | null,
): Promise<TmdbDiscoverMovie | null> {
	const params: Record<string, string | number> = {
		query: title,
		language: "en-US",
	};
	if (year) params.primary_release_year = year;
	try {
		const data = await tmdbFetch<{ results: TmdbDiscoverMovie[] }>(
			"/search/movie",
			params,
		);
		return data.results?.[0] || null;
	} catch {
		return null;
	}
}

async function searchTmdbTv(
	title: string,
	year?: number | null,
): Promise<TmdbDiscoverTv | null> {
	const params: Record<string, string | number> = {
		query: title,
		language: "en-US",
	};
	if (year) params.first_air_date_year = year;
	try {
		const data = await tmdbFetch<{ results: TmdbDiscoverTv[] }>(
			"/search/tv",
			params,
		);
		return data.results?.[0] || null;
	} catch {
		return null;
	}
}

/**
 * Main entry point: parse a free-text recommendation query and return TMDB results.
 * Recommendations are generated based on IMDb highly-rated selections using LLM and resolved via TMDB search.
 *
 * @param query  e.g. "comedy movies 2025", "thriller series from 2026"
 * @param limit  Maximum number of results to return (default 10)
 */
export async function discoverMedia(
	query: string,
	limit = 10,
): Promise<TmdbResult[]> {
	const mediaType = extractMediaType(query);

	const model = getCapableModel();

	const prompt = `You are a movie and TV show recommendation assistant. Suggest a list of up to ${limit} highly-rated and popular ${mediaType === "both"
		? "movies or TV shows"
		: mediaType === "movie"
			? "movies"
			: "TV shows/series"
		} that match the following criteria: "${query}".

CRITICAL: Your recommendations MUST be based on IMDb ratings and popularity. Only recommend titles that are critically acclaimed, widely recognized, and have a high IMDb rating (ideally 7.0+ or higher) and a large number of votes on IMDb. Do NOT suggest obscure, low-rating, or unreleased titles.`;

	const response = await generateObject({
		model,
		schema: z.object({
			recommendations: z.array(
				z.object({
					title: z
						.string()
						.describe("The exact English or localized title of the media"),
					year: z.number().nullable().describe("The release year (e.g. 2024)"),
					mediaType: z
						.enum(["movie", "tv"])
						.describe("Whether it is a movie or a TV show/series"),
					imdbRating: z
						.number()
						.nullable()
						.describe("Estimated/known IMDb rating (e.g. 8.2)"),
				}),
			),
		}),
		prompt,
	});

	const suggestions = response.object.recommendations || [];
	const results: TmdbResult[] = [];

	const genreMaps: Record<"movie" | "tv", Record<number, string>> = {
		movie: await fetchGenreMap("movie"),
		tv: await fetchGenreMap("tv"),
	};

	// Resolve suggestions in parallel
	await Promise.all(
		suggestions.map(async (item) => {
			if (item.mediaType === "movie") {
				const resolved = await searchTmdbMovie(item.title, item.year);
				if (resolved) {
					results.push({
						id: resolved.id,
						title: resolved.title,
						mediaType: "movie",
						year: parseYear(resolved.release_date),
						overview: resolved.overview,
						rating:
							item.imdbRating ??
							Math.round(resolved.vote_average * 10) / 10,
						voteCount: resolved.vote_count,
						genres: (resolved.genre_ids ?? [])
							.map((id) => genreMaps.movie[id] ?? "")
							.filter(Boolean),
						posterPath: resolved.poster_path ?? null,
					});
				}
			} else {
				const resolved = await searchTmdbTv(item.title, item.year);
				if (resolved) {
					results.push({
						id: resolved.id,
						title: resolved.name,
						mediaType: "tv",
						year: parseYear(resolved.first_air_date),
						overview: resolved.overview,
						rating:
							item.imdbRating ??
							Math.round(resolved.vote_average * 10) / 10,
						voteCount: resolved.vote_count,
						genres: (resolved.genre_ids ?? [])
							.map((id) => genreMaps.tv[id] ?? "")
							.filter(Boolean),
						posterPath: resolved.poster_path ?? null,
					});
				}
			}
		}),
	);

	// Sort by rating descending and cap at limit
	return results.sort((a, b) => b.rating - a.rating).slice(0, limit);
}
