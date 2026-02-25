import type { PlexSearchResult, PlexContainer } from "../types/plex";

const COUNTRY_ADJECTIVE_MAP: Record<string, string> = {
    // Common demonyms/adjectives -> country names as used by Plex metadata.
    // This helps when the model provides adjectives like "Argentine" instead of "Argentina".
    "japanese": "japan",
    "french": "france",
    "spanish": "spain",
    "american": "united states",
    "british": "united kingdom",
    "korean": "south korea",
    "chinese": "china",
    "german": "germany",
    "danish": "denmark",
    "dutch": "netherlands",
    "swedish": "sweden",
    "norwegian": "norway",
    "finnish": "finland",
    "polish": "poland",
    "turkish": "turkey",
    "greek": "greece",
    "portuguese": "portugal",
    "italian": "italy",
    "brazilian": "brazil",
    "russian": "russia",
    "mexican": "mexico",
    "canadian": "canada",
    "australian": "australia",
    "indian": "india",
    "argentine": "argentina",
    "argentinian": "argentina",
    // Spanish forms (occasionally produced by the model)
    "argentino": "argentina",
    "argentina": "argentina",
    "argentinas": "argentina",
    "argentinos": "argentina",
};

export function normalizeCountryName(input: string): string {
    const normalized = input.toLowerCase().trim();
    return COUNTRY_ADJECTIVE_MAP[normalized] || normalized;
}

export function getMovieSectionIds(): string[] {
    return process.env.PLEX_MOVIE_SECTION_IDS?.split(",").map(s => s.trim()) || [];
}

export function getShowSectionIds(): string[] {
    return process.env.PLEX_SHOW_SECTION_IDS?.split(",").map(s => s.trim()) || [];
}

/**
 * Helper to construct a full Plex URL for a thumbnail or art.
 */
export function getPosterUrl(thumb: string | undefined): string | undefined {
    if (!thumb) return undefined;
    const PLEX_URL = process.env.PLEX_URL?.trim();
    const PLEX_TOKEN = process.env.PLEX_TOKEN?.trim();
    if (!PLEX_URL || !PLEX_TOKEN) return undefined;

    return `${PLEX_URL}${thumb}?X-Plex-Token=${PLEX_TOKEN}`;
}

async function fetchPlex<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const PLEX_URL = process.env.PLEX_URL?.trim();
    const PLEX_TOKEN = process.env.PLEX_TOKEN?.trim();

    if (!PLEX_URL || !PLEX_TOKEN) {
        throw new Error("PLEX_URL or PLEX_TOKEN is not set. Plex features may not work.");
    }

    const url = new URL(endpoint, PLEX_URL);
    // Alternatively, token could be provided via X-Plex-Token header
    url.searchParams.append("X-Plex-Token", PLEX_TOKEN);

    // Plex requires Accept application/json to avoid returning XML
    // Some Plex servers also require basic client identification headers
    const response = await fetch(url.toString(), {
        ...options,
        headers: {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Plex-Token": PLEX_TOKEN,
            "X-Plex-Client-Identifier": "agentic-media-bot",
            "X-Plex-Product": "Agentic Media Bot",
            "X-Plex-Version": "1.0.0",
            ...options.headers,
        },
    });

    if (!response.ok) {
        throw new Error(`Plex API Error: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
}

/**
 * Global search across the Plex server.
 */
export async function searchPlex(query: string): Promise<PlexSearchResult> {
    const result = await fetchPlex<{ MediaContainer: PlexSearchResult }>(`/search?query=${encodeURIComponent(query)}`);
    return result.MediaContainer;
}

/**
 * Get recently added items globally.
 */
export async function getRecentlyAdded(): Promise<PlexContainer> {
    // /library/recentlyAdded
    const result = await fetchPlex<{ MediaContainer: PlexContainer }>("/library/recentlyAdded");
    return result.MediaContainer;
}

/**
 * Get Plex system status (basic connectivity check).
 */
export async function getSystemStatus(): Promise<any> {
    return fetchPlex<any>("/");
}

/**
 * Get all library sections (e.g., Movies, TV Shows).
 */
export async function getLibrarySections(): Promise<PlexContainer> {
    const result = await fetchPlex<{ MediaContainer: PlexContainer }>("/library/sections");
    return result.MediaContainer;
}

function extractFilterValueFromTagKey(rawKey: unknown, filterParam: string): string {
    if (typeof rawKey !== "string") return "";
    const key = rawKey.trim();
    if (!key) return "";

    // Some Plex tag keys are plain IDs (e.g. "42"), others are full paths
    // like "/library/sections/1/all?country=42". We normalize both forms.
    if (!key.includes("?")) return key;

    try {
        const parsed = new URL(key, "http://localhost");
        const value = parsed.searchParams.get(filterParam);
        return (value || key).trim();
    } catch {
        return key;
    }
}

function normalizeLibraryTagPath(rawKey: unknown): string | undefined {
    if (typeof rawKey !== "string") return undefined;
    const key = rawKey.trim();
    if (!key.startsWith("/")) return undefined;
    try {
        const parsed = new URL(key, "http://localhost");
        return `${parsed.pathname}${parsed.search}`;
    } catch {
        return key;
    }
}
/**
 * Get items by genre from a specific section.
 */
export async function getItemsByGenre(sectionId: string, genreName: string): Promise<PlexContainer> {
    const genres = await getLibraryGenres(sectionId);
    const genre = genres.find((g: any) => g.title.toLowerCase() === genreName.toLowerCase());

    if (!genre) {
        return { size: 0, identifier: "plex", mediaTagPrefix: "", mediaTagVersion: "", Metadata: [] };
    }

    // Prefer Plex-provided tag path when available, as it may include required internal params.
    const directTagPath = normalizeLibraryTagPath(genre.key);
    if (directTagPath) {
        const result = await fetchPlex<{ MediaContainer: PlexContainer }>(directTagPath);
        return result.MediaContainer;
    }

    const genreFilterValue = extractFilterValueFromTagKey(genre.key, "genre");
    const result = await fetchPlex<{ MediaContainer: PlexContainer }>(`/library/sections/${sectionId}/all?genre=${encodeURIComponent(genreFilterValue)}`);
    return result.MediaContainer;
}

/**
 * Get items by country from a specific section.
 */
export async function getItemsByCountry(sectionId: string, countryName: string): Promise<PlexContainer> {
    const countries = await getLibraryCountries(sectionId);
    const normalizedInput = countryName.toLowerCase().trim();
    const mappedName = normalizeCountryName(countryName);

    // 1. Try exact match (noun or adjective)
    let country = countries.find((c: any) =>
        c.title.toLowerCase() === normalizedInput ||
        c.title.toLowerCase() === mappedName
    );

    // 2. Try fuzzy match (if input is part of title or vice versa)
    if (!country) {
        country = countries.find((c: any) => {
            const title = c.title.toLowerCase();
            return title.includes(normalizedInput) || normalizedInput.includes(title) ||
                title.includes(mappedName) || mappedName.includes(title);
        });
    }

    if (!country) {
        return { size: 0, identifier: "plex", mediaTagPrefix: "", mediaTagVersion: "", Metadata: [] };
    }

    // Prefer Plex-provided tag path when available, as it may include required internal params.
    const directTagPath = normalizeLibraryTagPath(country.key);
    if (directTagPath) {
        const result = await fetchPlex<{ MediaContainer: PlexContainer }>(directTagPath);
        return result.MediaContainer;
    }

    const countryFilterValue = extractFilterValueFromTagKey(country.key, "country");
    const result = await fetchPlex<{ MediaContainer: PlexContainer }>(`/library/sections/${sectionId}/all?country=${encodeURIComponent(countryFilterValue)}`);
    return result.MediaContainer;
}

/**
 * Get available genres in a section.
 */
export async function getLibraryGenres(sectionId: string): Promise<any> {
    const result = await fetchPlex<any>(`/library/sections/${sectionId}/genre`);
    return result.MediaContainer?.Directory || [];
}

/**
 * Get available countries in a section.
 */
export async function getLibraryCountries(sectionId: string): Promise<any> {
    const result = await fetchPlex<any>(`/library/sections/${sectionId}/country`);
    return result.MediaContainer?.Directory || [];
}

/**
 * Get the total number of items in a specific section.
 */
export async function getLibrarySize(sectionId: string): Promise<number> {
    const result = await fetchPlex<{ MediaContainer: PlexContainer }>(`/library/sections/${sectionId}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`);
    return result.MediaContainer.totalSize || result.MediaContainer.size || 0;
}
