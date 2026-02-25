export interface SonarrSeries {
    id?: number;
    title: string;
    sortTitle?: string;
    status?: string;
    overview?: string;
    network?: string;
    year: number;
    tvdbId: number;
    monitored?: boolean;
    images?: Array<{ coverType: string; url: string }>;
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
