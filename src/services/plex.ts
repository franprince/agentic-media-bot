import type { PlexSearchResult, PlexContainer } from "../types/plex";
import { fetchService } from "./api";

const COUNTRY_NAME_MAP: Record<string, string> = {
    // English demonyms/adjectives -> country names as used by Plex metadata
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
    // Spanish demonyms/adjectives -> country names
    "japonés": "japan",
    "japonesa": "japan",
    "japones": "japan",
    "francés": "france",
    "francesa": "france",
    "frances": "france",
    "español": "spain",
    "española": "spain",
    "alemán": "germany",
    "alemana": "germany",
    "aleman": "germany",
    "italiano": "italy",
    "italiana": "italy",
    "coreano": "south korea",
    "coreana": "south korea",
    "corea": "south korea",
    "chino": "china",
    "china": "china",
    "británico": "united kingdom",
    "británica": "united kingdom",
    "britanico": "united kingdom",
    "britanica": "united kingdom",
    "americano": "united states",
    "americana": "united states",
    "argentino": "argentina",
    // Spanish country nouns -> country names
    "japón": "japan",
    "francia": "france",
    "españa": "spain",
    "alemania": "germany",
    "italia": "italy",
    "reino unido": "united kingdom",
    "estados unidos": "united states",
    "brasil": "brazil",
    "méxico": "mexico",
    "rusia": "russia",
    "india": "india",
    "canadá": "canada",
};

export function normalizeCountryName(input: string): string {
    const normalized = input.toLowerCase().trim();
    return COUNTRY_NAME_MAP[normalized] || normalized;
}

function extractCountryTags(metadata: any): string[] {
    const countries = metadata?.Country;
    if (!Array.isArray(countries)) return [];
    return countries
        .map((c: any) => c?.tag || c?.title)
        .filter((value: any) => typeof value === "string" && value.trim().length > 0)
        .map((value: string) => normalizeCountryName(value));
}

export async function getItemCountryTags(ratingKey: string): Promise<string[]> {
    const result = await fetchPlex<{ MediaContainer: PlexContainer }>(`/library/metadata/${ratingKey}`);
    const item = result.MediaContainer?.Metadata?.[0];
    return extractCountryTags(item);
}

export async function getItemMetadata(ratingKey: string): Promise<any | undefined> {
    const result = await fetchPlex<{ MediaContainer: PlexContainer }>(`/library/metadata/${ratingKey}`);
    return result.MediaContainer?.Metadata?.[0];
}

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    iterator: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let index = 0;

    async function worker() {
        let current: number;
        while ((current = index++) < items.length) {
            const item = items[current];
            if (item !== undefined) {
                results[current] = await iterator(item);
            }
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

export async function filterItemsByCountryTag(
    items: any[],
    countryName: string,
    options: { primaryOnly?: boolean } = {}
): Promise<any[]> {
    const target = normalizeCountryName(countryName);
    if (!target) return [];
    if (items.length === 0) return [];
    const primaryOnly = options.primaryOnly ?? true;

    const filteredFlags = await mapWithConcurrency(items, 5, async (item) => {
        const ratingKey = item?.ratingKey;
        if (!ratingKey) return false;
        const tags = await getItemCountryTags(String(ratingKey));
        if (tags.length === 0) return false;
        if (!tags.includes(target)) return false;
        if (!primaryOnly) return true;
        return tags[0] === target;
    });

    // Filter out undefined values (truthy check: false, 0, "", null, undefined are falsy)
    return items.filter((_item, idx) => filteredFlags[idx] ?? false);
}

export function getMovieSectionIds(): string[] {
    return process.env.PLEX_MOVIE_SECTION_IDS?.split(",").map(s => s.trim()) || [];
}

export function getShowSectionIds(): string[] {
    return process.env.PLEX_SHOW_SECTION_IDS?.split(",").map(s => s.trim()) || [];
}

export async function getAllSectionIds(): Promise<string[]> {
    const movieSectionIds = getMovieSectionIds();
    const showSectionIds = getShowSectionIds();

    if (movieSectionIds.length > 0 || showSectionIds.length > 0) {
        return [...movieSectionIds, ...showSectionIds];
    }

    const sections = await getLibrarySections();
    return (sections.Directory as any[])
        ?.filter(d => d.type === "movie" || d.type === "show")
        .map(d => d.key) || [];
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

/**
 * Helper to get a poster image as base64 data URL.
 * Returns a data URL that can be used directly in <img> tags or sent as a file.
 */
export async function getPosterData(thumb: string | undefined): Promise<string | undefined> {
    const url = getPosterUrl(thumb);
    if (!url) return undefined;

    const response = await fetch(url);

    if (!response.ok) return undefined;

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = response.headers.get("content-type") || "image/jpeg";

    return `data:${contentType};base64,${base64}`;
}


async function fetchPlex<T>(endpoint: string, options: any = {}): Promise<T> {
    const baseUrl = process.env.PLEX_URL?.trim() || "";
    const apiKey = process.env.PLEX_TOKEN?.trim() || "";

    return fetchService<T>(
        baseUrl,
        endpoint,
        "X-Plex-Token",
        apiKey,
        {
            ...options,
            headers: {
                "X-Plex-Client-Identifier": "agentic-media-bot",
                "X-Plex-Product": "Agentic Media Bot",
                "X-Plex-Version": "1.0.0",
                ...options.headers,
            },
        }
    );
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
    return result.MediaContainer?.totalSize ?? result.MediaContainer?.size ?? 0;
}

/**
 * Get all items from a specific section.
 * Plex paginates results, so we need to fetch in batches.
 */
export async function getItemsByDuration(sectionId: string): Promise<PlexContainer> {
    // First, get the total count to know how many to fetch
    const initialResult = await fetchPlex<{ MediaContainer: PlexContainer }>(
        `/library/sections/${sectionId}/all?X-Plex-Container-Start=0&X-Plex-Container-Size=0`
    );

    const totalSize = initialResult.MediaContainer.totalSize || initialResult.MediaContainer.size || 0;

    if (totalSize === 0) {
        return { size: 0, identifier: "plex", mediaTagPrefix: "", mediaTagVersion: "", Metadata: [] };
    }

    // Plex typically returns up to 100 items per request
    const batchSize = 100;
    const allMetadata: any[] = [];

    // If we have initial metadata (when totalSize is 0 but size > 0), include it
    if (initialResult.MediaContainer.Metadata) {
        allMetadata.push(...initialResult.MediaContainer.Metadata);
    }

    // Fetch remaining items in batches
    for (let start = allMetadata.length; start < totalSize; start += batchSize) {
        const result = await fetchPlex<{ MediaContainer: PlexContainer }>(
            `/library/sections/${sectionId}/all?X-Plex-Container-Start=${start}&X-Plex-Container-Size=${batchSize}`
        );
        if (result.MediaContainer.Metadata) {
            allMetadata.push(...result.MediaContainer.Metadata);
        }
    }

    return {
        size: allMetadata.length,
        totalSize: totalSize,
        identifier: "plex",
        mediaTagPrefix: initialResult.MediaContainer.mediaTagPrefix || "",
        mediaTagVersion: initialResult.MediaContainer.mediaTagVersion || "",
        Metadata: allMetadata,
    };
}
