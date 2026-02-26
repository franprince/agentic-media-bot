export interface PlexMetadata {
    ratingKey: string;
    key: string;
    guid: string;
    type: string; // "movie", "show", "episode"
    title: string;
    summary: string;
    year?: number;
    thumb?: string;
    art?: string;
    originalTitle?: string;
    addedAt?: number;
    updatedAt?: number;
    duration?: number; // Duration in milliseconds
    Country?: Array<{ tag?: string; title?: string }>;
    // For shows/episodes
    parentTitle?: string;
    grandparentTitle?: string;
}

export interface PlexSearchResult {
    size: number;
    Metadata?: PlexMetadata[];
}

export interface PlexDirectory {
    key: string;
    title: string;
    type: string;
    composite?: string;
}

export interface PlexContainer {
    size: number;
    totalSize?: number;
    identifier: string;
    mediaTagPrefix: string;
    mediaTagVersion: string;
    Metadata?: PlexMetadata[];
    Directory?: PlexDirectory[];
}
