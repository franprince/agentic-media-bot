export interface SonarrSeries {
    id?: number;
    title: string;
    originalTitle?: string;
    sortTitle?: string;
    status?: string;
    overview?: string;
    network?: string;
    genres?: string[];
    year: number;
    tvdbId: number;
    imdbId?: string;
    monitored?: boolean;
    images?: Array<{ coverType: string; url: string; remoteUrl?: string }>;
    ratings?: {
        votes: number;
        value: number;
    };
    // Additional fields needed for adding
    qualityProfileId?: number;
    languageProfileId?: number;
    rootFolderPath?: string;
    addOptions?: {
        ignoreEpisodesWithFiles?: boolean;
        ignoreEpisodesWithoutFiles?: boolean;
        searchForMissingEpisodes?: boolean;
    };
    seasons?: Array<{ seasonNumber: number; monitored: boolean }>;
    statistics?: {
        percentOfEpisodes: number;
        episodeCount: number;
        episodeFileCount: number;
    };
    path?: string;
}

export interface SonarrQueueItem {
    id: number;
    seriesId: number;
    episodeId: number;
    title: string;
    size: number;
    sizeleft: number;
    status: string;
    trackedDownloadStatus: string;
    trackedDownloadState: string;
    errorMessage?: string;
}

export interface SonarrWebhookPayload {
    eventType: "Grab" | "Download" | "SeriesAdd" | "Test";
    series: {
        id: number;
        title: string;
        path: string;
        tvdbId: number;
        tvMazeId?: number;
        imdbId?: string;
        type: string;
    };
    episodes?: Array<{
        id: number;
        episodeNumber: number;
        seasonNumber: number;
        title: string;
        airDate?: string;
        airDateUtc?: string;
    }>;
    release?: {
        quality: string;
        qualityVersion: number;
        releaseGroup?: string;
        releaseTitle: string;
        indexer: string;
        size: number;
    };
    episodeFile?: {
        id: number;
        relativePath: string;
        path: string;
        quality: string | {
            quality: {
                id: number;
                name: string;
                source?: string;
                resolution?: number;
            };
            revision: {
                version: number;
                real: number | boolean;
                isRepack?: boolean;
            };
        };
    };
    downloadClient?: string;
    downloadId?: string;
}
