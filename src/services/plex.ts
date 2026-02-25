import type { PlexSearchResult, PlexContainer } from "../types/plex";

export function getMovieSectionIds(): string[] {
    return process.env.PLEX_MOVIE_SECTION_IDS?.split(",").map(s => s.trim()) || [];
}

export function getShowSectionIds(): string[] {
    return process.env.PLEX_SHOW_SECTION_IDS?.split(",").map(s => s.trim()) || [];
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
/**
 * Get items by genre from a specific section.
 */
export async function getItemsByGenre(sectionId: string, genreName: string): Promise<PlexContainer> {
    const genres = await getLibraryGenres(sectionId);
    const genre = genres.find((g: any) => g.title.toLowerCase() === genreName.toLowerCase());

    if (!genre) {
        return { size: 0, identifier: "plex", mediaTagPrefix: "", mediaTagVersion: "", Metadata: [] };
    }

    // Plex uses the 'key' (often an ID) for the genre filter
    const result = await fetchPlex<{ MediaContainer: PlexContainer }>(`/library/sections/${sectionId}/all?genre=${genre.key}`);
    return result.MediaContainer;
}

/**
 * Get available genres in a section.
 */
export async function getLibraryGenres(sectionId: string): Promise<any> {
    const result = await fetchPlex<any>(`/library/sections/${sectionId}/genre`);
    return result.MediaContainer?.Directory || [];
}
