import type { SonarrSeries, SonarrQueueItem } from "../types/sonarr";
import { fetchService } from "./api";

async function fetchSonarr<T>(endpoint: string, options: any = {}): Promise<T> {
    const baseUrl = process.env.SONARR_URL?.trim() || "";
    const apiKey = process.env.SONARR_API_KEY?.trim() || "";

    return fetchService<T>(
        baseUrl,
        `/api/v3${endpoint}`,
        "apikey",
        apiKey,
        options
    );
}

/**
 * Search for a series in Sonarr using TVDB.
 */
export async function searchSeries(term: string): Promise<SonarrSeries[]> {
    return fetchSonarr<SonarrSeries[]>(`/series/lookup?term=${encodeURIComponent(term)}`);
}

/**
 * Get series details by TVDB ID.
 */
export async function getSeriesByTvdbId(tvdbId: number): Promise<SonarrSeries | undefined> {
    const results = await fetchSonarr<SonarrSeries[]>(`/series/lookup?term=tvdb:${tvdbId}`);
    return results.find(s => s.tvdbId === tvdbId);
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
    const allSeries = await fetchSonarr<SonarrSeries[]>("/series");
    const existing = allSeries.find(s => s.tvdbId === tvdbId);
    if (existing) {
        return existing;
    }

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
