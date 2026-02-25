export interface RadarrMovie {
    id?: number;
    title: string;
    originalTitle?: string;
    overview?: string;
    year: number;
    tmdbId: number;
    imdbId?: string;
    genres?: string[];
    hasFile?: boolean;
    monitored?: boolean;
    sizeOnDisk?: number;
    images?: Array<{ coverType: string; url: string }>;
    // Additional fields needed for adding
    qualityProfileId?: number;
    rootFolderPath?: string;
}

export interface RadarrQueueItem {
    id: number;
    movieId: number;
    title: string;
    size: number;
    sizeleft: number;
    status: string;
    trackedDownloadStatus: string;
    trackedDownloadState: string;
    errorMessage?: string;
}
