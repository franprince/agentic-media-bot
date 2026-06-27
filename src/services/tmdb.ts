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

/** Extract a 4-digit year from a free-text query string */
function extractYear(query: string): number | null {
    const match = query.match(/\b(20\d{2})\b/);
    return match ? parseInt(match[1], 10) : null;
}

/** Determine whether the query is asking for movies, TV, or both */
function extractMediaType(query: string): "movie" | "tv" | "both" {
    const lower = query.toLowerCase();
    const tvKeywords = ["series", "show", "tv", "television", "season", "episode", "sitcom"];
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
        return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    }
    if (apiKey) {
        // Fallback: api_key is appended in the URL; return minimal headers
        return { "Content-Type": "application/json" };
    }
    throw new Error("No TMDB credentials found. Set TMDB_READ_ACCESS_TOKEN or TMDB_READ_API_KEY.");
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

async function tmdbFetch<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
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
async function fetchGenreMap(type: "movie" | "tv"): Promise<Record<number, string>> {
    try {
        const data = await tmdbFetch<{ genres: Array<{ id: number; name: string }> }>(
            `/genre/${type}/list`,
            { language: "en" }
        );
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
    const y = parseInt(dateStr.split("-")[0], 10);
    return isNaN(y) ? null : y;
}

/** Discover movies matching year/genre constraints */
async function discoverMovies(
    year: number | null,
    genreIds: number[],
    page = 1
): Promise<{ results: TmdbDiscoverMovie[]; totalResults: number }> {
    const params: Record<string, string | number> = {
        language: "en-US",
        sort_by: "vote_average.desc",
        "vote_count.gte": 50,
        page,
    };
    if (year) {
        params["primary_release_year"] = year;
    } else {
        // Default to last 2 years when no year specified
        const thisYear = new Date().getFullYear();
        params["primary_release_date.gte"] = `${thisYear - 1}-01-01`;
    }
    if (genreIds.length > 0) params["with_genres"] = genreIds.join(",");

    const data = await tmdbFetch<{ results: TmdbDiscoverMovie[]; total_results: number }>(
        "/discover/movie",
        params
    );
    return { results: data.results, totalResults: data.total_results };
}

/** Discover TV shows matching year/genre constraints */
async function discoverTv(
    year: number | null,
    genreIds: number[],
    page = 1
): Promise<{ results: TmdbDiscoverTv[]; totalResults: number }> {
    const params: Record<string, string | number> = {
        language: "en-US",
        sort_by: "vote_average.desc",
        "vote_count.gte": 20,
        page,
    };
    if (year) {
        params["first_air_date_year"] = year;
    } else {
        const thisYear = new Date().getFullYear();
        params["first_air_date.gte"] = `${thisYear - 1}-01-01`;
    }
    if (genreIds.length > 0) params["with_genres"] = genreIds.join(",");

    const data = await tmdbFetch<{ results: TmdbDiscoverTv[]; total_results: number }>(
        "/discover/tv",
        params
    );
    return { results: data.results, totalResults: data.total_results };
}

/**
 * Main entry point: parse a free-text recommendation query and return TMDB results.
 *
 * @param query  e.g. "comedy movies 2025", "thriller series from 2026"
 * @param limit  Maximum number of results to return (default 10)
 */
export async function discoverMedia(query: string, limit = 10): Promise<TmdbResult[]> {
    const year = extractYear(query);
    const mediaType = extractMediaType(query);

    const results: TmdbResult[] = [];

    if (mediaType === "movie" || mediaType === "both") {
        const genreIds = extractGenreIds(query, "movie");
        const genreMap = await fetchGenreMap("movie");
        const { results: movies } = await discoverMovies(year, genreIds);
        for (const m of movies.slice(0, limit)) {
            results.push({
                id: m.id,
                title: m.title,
                mediaType: "movie",
                year: parseYear(m.release_date),
                overview: m.overview,
                rating: Math.round(m.vote_average * 10) / 10,
                voteCount: m.vote_count,
                genres: (m.genre_ids ?? []).map((id) => genreMap[id] ?? "").filter(Boolean),
                posterPath: m.poster_path ?? null,
            });
        }
    }

    if (mediaType === "tv" || mediaType === "both") {
        const genreIds = extractGenreIds(query, "tv");
        const genreMap = await fetchGenreMap("tv");
        const { results: shows } = await discoverTv(year, genreIds);
        for (const s of shows.slice(0, limit)) {
            results.push({
                id: s.id,
                title: s.name,
                mediaType: "tv",
                year: parseYear(s.first_air_date),
                overview: s.overview,
                rating: Math.round(s.vote_average * 10) / 10,
                voteCount: s.vote_count,
                genres: (s.genre_ids ?? []).map((id) => genreMap[id] ?? "").filter(Boolean),
                posterPath: s.poster_path ?? null,
            });
        }
    }

    // Sort by rating descending and cap at limit
    return results
        .sort((a, b) => b.rating - a.rating)
        .slice(0, limit);
}
