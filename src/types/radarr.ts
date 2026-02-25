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
    images?: Array<{ coverType: string; url: string; remoteUrl?: string }>;
    ratings?: {
        imdb?: { value: number; votes: number };
        tmdb?: { value: number; votes: number };
        metacritic?: { value: number; votes: number };
        rottenTomatoes?: { value: number; votes: number };
    };
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
