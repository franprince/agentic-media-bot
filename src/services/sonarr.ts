import type { SonarrSeries, SonarrQueueItem } from "../types/sonarr";
import { fetchService } from "./api";
import { executeOnProxy, isProxyEnabled } from "../agent/proxyClient";

async function fetchSonarr<T>(endpoint: string, options: any = {}): Promise<T> {
    if (isProxyEnabled()) {
        const caller = new Error().stack?.split("\n")[2]?.trim() || "";
        const methodName = caller.match(/at\s+(?:async\s+)?(\w+)/)?.[1] || "unknown";
        if (methodName !== "fetchSonarr") {
            return executeOnProxy("sonarr", methodName, options.body ? [JSON.parse(options.body)] : []);
        }
    }

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

export async function searchSeries(term: string): Promise<SonarrSeries[]> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "searchSeries", [term]);
    return fetchSonarr<SonarrSeries[]>(`/series/lookup?term=${encodeURIComponent(term)}`);
}

export async function getSeriesByTvdbId(tvdbId: number): Promise<SonarrSeries | undefined> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getSeriesByTvdbId", [tvdbId]);
    const results = await fetchSonarr<SonarrSeries[]>(`/series/lookup?term=tvdb:${tvdbId}`);
    return results.find(s => s.tvdbId === tvdbId);
}

export async function addSeries(
    tvdbId: number,
    title: string,
    qualityProfileId: number,
    languageProfileId: number,
    rootFolderPath: string,
    seasons: Array<{ seasonNumber: number; monitored: boolean }>,
    seriesType: "standard" | "daily" | "anime" = "standard",
    tags?: number[]
): Promise<SonarrSeries> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "addSeries", [tvdbId, title, qualityProfileId, languageProfileId, rootFolderPath, seasons, seriesType, tags]);
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
        seriesType, // Add seriesType to payload
        addOptions: {
            ignoreEpisodesWithFiles: false,
            ignoreEpisodesWithoutFiles: false,
            searchForMissingEpisodes: true,
        },
        tags: tags || [],
    };

    return fetchSonarr<SonarrSeries>("/series", {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

export async function getSeriesQueue(): Promise<SonarrQueueItem[]> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getSeriesQueue");
    const result = await fetchSonarr<{ records: SonarrQueueItem[] }>("/queue");
    return result.records;
}

export async function getRootFolders(): Promise<Array<{ id: number, path: string, freeSpace: number }>> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getRootFolders");
    return fetchSonarr("/rootfolder");
}

export async function getQualityProfiles(): Promise<Array<{ id: number, name: string }>> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getQualityProfiles");
    return fetchSonarr("/qualityprofile");
}

export async function getLanguageProfiles(): Promise<Array<{ id: number, name: string }>> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getLanguageProfiles");
    return fetchSonarr("/languageprofile");
}

export async function getSystemStatus(): Promise<any> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getSystemStatus");
    return fetchSonarr<any>("/system/status");
}

export async function getMissingSeries(): Promise<SonarrSeries[]> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getMissingSeries");
    const series = await fetchSonarr<SonarrSeries[]>("/series");
    // Return series where monitored is true and statistics.percentOfEpisodes < 100
    return series.filter(s => s.monitored && (s.statistics?.percentOfEpisodes ?? 100) < 100);
}

export async function getMissingEpisodes(pageSize: number = 20): Promise<any> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getMissingEpisodes", [pageSize]);
    const result = await fetchSonarr<any>(`/wanted/missing?pageSize=${pageSize}&includeSeries=true`);
    return result;
}

/**
 * Restart Sonarr service using systemctl.
 */
export async function restartSonarrService(): Promise<void> {
    console.log("🔄 Attempting to restart Sonarr service: systemctl restart snap.sonarr.sonarr.service");
    try {
        const proc = Bun.spawn({
            cmd: ["systemctl", "restart", "snap.sonarr.sonarr.service"],
            stdout: "inherit",
            stderr: "inherit",
        });
        await proc.exited;
        console.log("✅ Sonarr service restart command executed.");
    } catch (error) {
        console.error("❌ Failed to restart Sonarr service:", error);
    }
}

export async function getTags(): Promise<Array<{ id: number, label: string }>> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "getTags", []);
    return fetchSonarr<Array<{ id: number, label: string }>>("/tag");
}

export async function createTag(label: string): Promise<{ id: number, label: string }> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "createTag", [label]);
    return fetchSonarr<{ id: number, label: string }>("/tag", {
        method: "POST",
        body: JSON.stringify({ label }),
    });
}

export async function resolveTagIds(labels: string[]): Promise<number[]> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "resolveTagIds", [labels]);
    if (!labels || labels.length === 0) return [];
    
    const existingTags = await getTags();
    const tagIds: number[] = [];

    for (const label of labels) {
        const cleaned = label.trim().toLowerCase();
        if (!cleaned) continue;

        const match = existingTags.find(t => t.label.toLowerCase() === cleaned);
        if (match) {
            tagIds.push(match.id);
        } else {
            try {
                const newTag = await createTag(cleaned);
                tagIds.push(newTag.id);
            } catch (err: any) {
                console.error(`Failed to create Sonarr tag "${cleaned}":`, err.message);
            }
        }
    }
    return tagIds;
}

export async function deleteSeries(id: number, deleteFiles: boolean = false): Promise<void> {
    if (isProxyEnabled()) return executeOnProxy("sonarr", "deleteSeries", [id, deleteFiles]);
    await fetchSonarr(`/series/${id}?deleteFiles=${deleteFiles}`, {
        method: "DELETE",
    });
}
