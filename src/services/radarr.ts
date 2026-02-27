import type { RadarrMovie, RadarrQueueItem } from "../types/radarr";
import { fetchService } from "./api";

async function fetchRadarr<T>(endpoint: string, options: any = {}): Promise<T> {
    const baseUrl = process.env.RADARR_URL?.trim() || "";
    const apiKey = process.env.RADARR_API_KEY?.trim() || "";

    return fetchService<T>(
        baseUrl,
        `/api/v3${endpoint}`,
        "apikey",
        apiKey,
        options
    );
}

/**
 * Search for a movie in Radarr using TMDB.
 */
export async function searchMovie(term: string): Promise<RadarrMovie[]> {
    return fetchRadarr<RadarrMovie[]>(`/movie/lookup?term=${encodeURIComponent(term)}`);
}

/**
 * Add a movie to Radarr.
 * Usually requires rootFolderPath and qualityProfileId to be set from your Radarr instance.
 */
export async function addMovie(tmdbId: number, title: string, year: number, rootFolderPath: string, qualityProfileId: number): Promise<RadarrMovie> {
    const allMovies = await fetchRadarr<RadarrMovie[]>("/movie");
    const existing = allMovies.find(m => m.tmdbId === tmdbId);
    if (existing) {
        return existing; // Already exists, return current record
    }

    const payload = {
        title,
        qualityProfileId,
        year,
        tmdbId,
        rootFolderPath,
        monitored: true,
        addOptions: {
            searchForMovie: true,
        },
    };

    return fetchRadarr<RadarrMovie>("/movie", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

/**
 * Get the current activity queue.
 */
export async function getMovieQueue(): Promise<RadarrQueueItem[]> {
    const result = await fetchRadarr<{ records: RadarrQueueItem[] }>("/queue");
    return result.records;
}

/**
 * Get the root folders configured in Radarr (needed for adding movies).
 */
export async function getRootFolders(): Promise<Array<{ id: number, path: string, freeSpace: number }>> {
    return fetchRadarr("/rootfolder");
}

/**
 * Get the quality profiles configured in Radarr (needed for adding movies).
 */
export async function getQualityProfiles(): Promise<Array<{ id: number, name: string }>> {
    return fetchRadarr("/qualityprofile");
}

/**
 * Get Radarr system status.
 */
export async function getSystemStatus(): Promise<any> {
    return fetchRadarr<any>("/system/status");
}

/**
 * Get movies that are monitored but missing files.
 */
export async function getMissingMovies(): Promise<RadarrMovie[]> {
    const movies = await fetchRadarr<RadarrMovie[]>("/movie");
    return movies.filter(m => m.monitored && !m.hasFile);
}
