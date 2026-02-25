import type { SonarrSeries, SonarrQueueItem } from "../types/sonarr";

async function fetchSonarr<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const SONARR_URL = process.env.SONARR_URL?.trim();
    const SONARR_API_KEY = process.env.SONARR_API_KEY?.trim();

    if (!SONARR_URL || !SONARR_API_KEY) {
        throw new Error("SONARR_URL or SONARR_API_KEY is not set.");
    }

    const url = new URL(`/api/v3${endpoint}`, SONARR_URL);
    url.searchParams.append("apikey", SONARR_API_KEY);

    const response = await fetch(url.toString(), {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...options.headers,
        },
    });

    if (!response.ok) {
        throw new Error(`Sonarr API Error: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
}

/**
 * Search for a series in Sonarr using TVDB.
 */
export async function searchSeries(term: string): Promise<SonarrSeries[]> {
    return fetchSonarr<SonarrSeries[]>(`/series/lookup?term=${encodeURIComponent(term)}`);
}

/**
 * Add a series to Sonarr.
 */
export async function addSeries(
    tvdbId: number,
    title: string,
    qualityProfileId: number,
    languageProfileId: number,
    rootFolderPath: string,
    seasons: Array<{ seasonNumber: number; monitored: boolean }>
): Promise<SonarrSeries> {
    const payload = {
        title,
        qualityProfileId,
        languageProfileId,
        tvdbId,
        rootFolderPath,
        monitored: true,
        seasons,
        addOptions: {
            ignoreEpisodesWithFiles: false,
            ignoreEpisodesWithoutFiles: false,
            searchForMissingEpisodes: true,
        },
    };

    return fetchSonarr<SonarrSeries>("/series", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

/**
 * Get the current activity queue.
 */
export async function getSeriesQueue(): Promise<SonarrQueueItem[]> {
    const result = await fetchSonarr<{ records: SonarrQueueItem[] }>("/queue");
    return result.records;
}

/**
 * Get the root folders configured in Sonarr (needed for adding series).
 */
export async function getRootFolders(): Promise<Array<{ id: number, path: string, freeSpace: number }>> {
    return fetchSonarr("/rootfolder");
}

/**
 * Get the quality profiles configured in Sonarr (needed for adding series).
 */
export async function getQualityProfiles(): Promise<Array<{ id: number, name: string }>> {
    return fetchSonarr("/qualityprofile");
}

/**
 * Get the language profiles configured in Sonarr (needed for adding series).
 */
export async function getLanguageProfiles(): Promise<Array<{ id: number, name: string }>> {
    return fetchSonarr("/languageprofile");
}

/**
 * Get Sonarr system status.
 */
export async function getSystemStatus(): Promise<any> {
    return fetchSonarr<any>("/system/status");
}

/**
 * Get series with missing episodes.
 */
export async function getMissingSeries(): Promise<SonarrSeries[]> {
    const series = await fetchSonarr<SonarrSeries[]>("/series");
    // Return series where monitored is true and statistics.percentOfEpisodes < 100
    return series.filter(s => s.monitored && (s.statistics?.percentOfEpisodes ?? 100) < 100);
}

/**
 * Get specific missing episodes with series details.
 */
export async function getMissingEpisodes(pageSize: number = 20): Promise<any> {
    const result = await fetchSonarr<any>(`/wanted/missing?pageSize=${pageSize}&includeSeries=true`);
    return result;
}
