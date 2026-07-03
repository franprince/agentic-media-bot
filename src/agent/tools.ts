import { tool } from "ai";
import { z } from "zod";
import * as radarr from "../services/radarr";
import * as sonarr from "../services/sonarr";
import * as qbittorrent from "../services/qbittorrent";
import * as plex from "../services/plex";
import * as db from "../services/database";
import * as nzbget from "../services/nzbget";

// Helper to find default quality profile matching "Full-HD or Better"
function getDefaultQualityProfile(profiles: Array<{ id: number; name: string }>): { id: number; name: string } | undefined {
    if (!profiles || profiles.length === 0) return undefined;
    const preferred = profiles.find(p => {
        const name = p.name.toLowerCase();
        return name.includes("full-hd") || name.includes("full hd") || name.includes("fullhd");
    }) || profiles.find(p => p.name.toLowerCase().includes("1080p"));
    return preferred || profiles[0];
}

// Helper to find default language profile matching "Original" or "Original Language"
function getDefaultLanguageProfile(languages: Array<{ id: number; name: string }>): { id: number; name: string } | undefined {
    if (!languages || languages.length === 0) return undefined;
    const preferred = languages.find(l => {
        const name = l.name.toLowerCase();
        return name.includes("original");
    });
    return preferred || languages[0];
}

// --- Type Definitions --- //
interface PlexMediaItem {
    ratingKey?: string;
    guid?: string;
    title?: string;
    year?: number;
    summary?: string;
    thumb?: string;
    originalTitle?: string;
    type?: string;
    librarySectionType?: string;
    rating?: number;
    audienceRating?: number;
    userRating?: number;
    durationMinutes?: number;
    images?: Array<{
        coverType: string;
        remoteUrl?: string;
        url?: string;
    }>;
}

interface MovieSearchResult {
    title: string;
    originalTitle?: string;
    year: number;
    genres: string[];
    tmdbId: number;
    imdbId?: string;
    overview: string;
    posterUrl?: string;
}

interface PlexSearchResult {
    totalFound: number;
    queryType?: string;
    searchParam?: string;
    sampleItems: Array<{
        title: string;
        originalTitle?: string;
        year?: number;
        overview?: string;
        posterUrl?: string;
    }>;
}

interface ToolError {
    message: string;
    suggestions?: MovieSearchResult[];
}

// --- Caching for Profiles & Folders --- //
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 100; // LRU cache limit

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    accessCount: number;
    lastAccessed: number;
}

class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private maxSize: number;

    constructor(maxSize: number = MAX_CACHE_ENTRIES) {
        this.maxSize = maxSize;
        // Set up periodic cleanup every 10 minutes
        setInterval(() => this.cleanup(), 10 * 60 * 1000);
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        const now = Date.now();
        if (now - entry.timestamp > CACHE_TTL) {
            this.cache.delete(key);
            return undefined;
        }

        // Update access tracking
        entry.accessCount++;
        entry.lastAccessed = now;

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.data;
    }

    set(key: string, data: T): void {
        const now = Date.now();

        // Remove existing entry if present
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Ensure size limit
        if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first entry)
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            data,
            timestamp: now,
            accessCount: 1,
            lastAccessed: now
        });
    }

    cleanup(): void {
        const now = Date.now();
        const toDelete: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > CACHE_TTL) {
                toDelete.push(key);
            }
        }

        toDelete.forEach(key => this.cache.delete(key));

        if (toDelete.length > 0) {
            console.log(`🧹 Cache cleanup: removed ${toDelete.length} expired entries`);
        }
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

const configCache = new LRUCache<any>();

// Export cache management functions for external invalidation
export function clearCache(): void {
    configCache.clear();
}

export function invalidateCachePattern(pattern: string): void {
    // This would require extending LRUCache to support pattern matching
    // For now, we'll clear the entire cache when pattern-based invalidation is needed
    configCache.clear();
}

async function withCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = configCache.get(key);
    if (cached) {
        return cached;
    }
    const data = await fetcher();
    configCache.set(key, data);
    return data;
}

function deduplicatePlexItems(items: PlexMediaItem[]): PlexMediaItem[] {
    const unique = new Map<string, PlexMediaItem>();
    for (const item of items) {
        const dedupeKey = item?.ratingKey || item?.guid || `${item?.title ?? "untitled"}::${item?.year ?? ""}`;
        if (!unique.has(dedupeKey)) unique.set(dedupeKey, item);
    }
    return [...unique.values()];
}

function hasNonLatinCharacters(value: string): boolean {
    return /[^\u0000-\u024f\s"'`~!@#$%^&*()\-_=+\[\]{}\\|;:,./<>?0-9]/.test(value);
}

function pickLatinAliasCandidate(candidates: Array<string | undefined>, title: string): string | undefined {
    const normalizedTitle = title.trim().toLowerCase();
    for (const raw of candidates) {
        const candidate = raw?.trim();
        if (!candidate) continue;
        if (candidate.toLowerCase() === normalizedTitle) continue;
        if (hasNonLatinCharacters(candidate)) continue;
        return candidate;
    }
    return undefined;
}

function stripDiacritics(value: string): string {
    try {
        return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
    } catch {
        return value;
    }
}

function uniqueNonEmptyStrings(values: Array<string | undefined | null>): string[] {
    const unique = new Set<string>();
    for (const value of values) {
        const trimmed = typeof value === "string" ? value.trim() : "";
        if (!trimmed) continue;
        unique.add(trimmed);
    }
    return [...unique.values()];
}

// --- Radarr Tools --- //

export const searchMovieTool = tool({
    description: "Search for a movie in Radarr to get its details, like TMDB ID, year, and if it's already downloaded. USE THIS ONLY ONLY when searching for a SPECIFIC MOVIE TITLE. Do NOT use this for 'Japanese movies', genres like 'Horror', or country-based queries.",
    parameters: z.object({
        term: z.string().describe("The name of the movie to search for (e.g., 'Deadpool'). Do NOT include country names or genres here."),
    }),
    execute: async ({ term }: { term: string }) => {
        const normalizedTerm = term?.trim();
        if (!normalizedTerm) {
            return { message: "Please provide a movie title to search in Radarr." } as any;
        }

        try {
            const results = await radarr.searchMovie(normalizedTerm);
            // Limit results to avoid massive context payloads
            return results.slice(0, 5).map(m => ({
                title: m.title,
                mediaType: "[Movie]",
                originalTitle: m.originalTitle,
                year: m.year,
                genres: m.genres,
                tmdbId: m.tmdbId,
                imdbId: m.imdbId,
                overview: m.overview,
                posterUrl: m.images?.find(i => i.coverType === "poster")?.remoteUrl || m.images?.find(i => i.coverType === "poster")?.url,
                hasFile: m.hasFile,
                monitored: m.monitored,
                ratings: m.ratings,
            })) as any;
        } catch (_error: any) {
            return { message: "I couldn't query Radarr right now. Please try again in a moment." } as any;
        }
    },
});

export const addMovieTool = tool({
    description: "Add a MOVIE to Radarr to begin downloading it. Requires the TMDB ID from a previous search. Do NOT use this for TV shows/series. This tool will first return details and available configuration options (quality profiles, folders) for confirmation unless 'confirm' is true.",
    parameters: z.object({
        tmdbId: z.union([z.number(), z.string().transform(Number)]).nullable().describe("The TMDB ID of the movie to add."),
        title: z.string().describe("The title of the movie."),
        year: z.union([z.number(), z.string().transform(Number)]).nullable().describe("The release year of the movie."),
        imdbId: z.string().optional().describe("The IMDb ID of the movie (e.g., 'tt0111161')."),
        qualityProfileId: z.number().optional().describe("The ID of the quality profile to use (e.g., 1 for HD-1080p)."),
        rootFolderPath: z.string().optional().describe("The root folder path where the movie should be saved."),
        confirm: z.boolean().default(false).describe("Set to true ONLY when the user has explicitly confirmed the specific match and settings (folder, profile)."),
    }),
    execute: async ({ tmdbId, title, year, imdbId, qualityProfileId, rootFolderPath, confirm }: { tmdbId: number | null, title: string, year: number | null, imdbId?: string, qualityProfileId?: number, rootFolderPath?: string, confirm: boolean }) => {
        let normalizedTmdbId = (tmdbId !== null && tmdbId !== undefined) ? Number(tmdbId) : 0;
        let normalizedYear = (year !== null && year !== undefined) ? Number(year) : 0;

        let imdbMatch: any = null;
        if (imdbId) {
            try {
                const results = await radarr.searchMovie(imdbId);
                imdbMatch = results[0];
                if (imdbMatch) {
                    normalizedTmdbId = imdbMatch.tmdbId;
                    normalizedYear = imdbMatch.year;
                }
            } catch (err) {
                console.warn(`⚠️ IMDb search failed for ${imdbId}:`, (err as Error).message);
            }
        }

        if (normalizedTmdbId <= 0 || normalizedYear <= 0) {
            try {
                const results = await radarr.searchMovie(title);
                return {
                    message: "Missing TMDB ID or year. Please choose the correct match first.",
                    suggestions: results.slice(0, 5).map(m => ({
                        title: m.title,
                        originalTitle: m.originalTitle,
                        year: m.year,
                        genres: m.genres,
                        tmdbId: m.tmdbId,
                        imdbId: m.imdbId,
                        overview: m.overview,
                        posterUrl: m.images?.find(i => i.coverType === "poster")?.remoteUrl || m.images?.find(i => i.coverType === "poster")?.url,
                    })),
                } as any;
            } catch (error: any) {
                return {
                    message: "I couldn't search Radarr for that title due to a service error. Please try again in a moment, or ask me to search Plex instead.",
                } as any;
            }
        }

        try {
            // Fetch required configuration dynamically
            const [profiles, folders] = await Promise.all([
                withCache("radarr_profiles", () => radarr.getQualityProfiles()),
                withCache("radarr_folders", () => radarr.getRootFolders())
            ]);

            if (profiles.length === 0 || folders.length === 0) {
                return { message: "Cannot add movie right now: Radarr quality profiles or root folders are unavailable." } as any;
            }

            // Find match details for confirmation or adding
            const results = await radarr.searchMovie(title);
            const match = results.find(m => m.tmdbId === normalizedTmdbId && m.year === normalizedYear) || results[0];

            if (!match) {
                return { message: `Could not find movie details for "${title}" (${normalizedYear}) to proceed.` } as any;
            }

            const titleMismatch = imdbMatch && stripDiacritics(match.title.toLowerCase()) !== stripDiacritics(title.toLowerCase());

            const defaultProfile = getDefaultQualityProfile(profiles);

            if (!confirm || titleMismatch) {
                let statusMessage = `I found "${match.title}" (${match.year}). Please confirm if I should add it and which settings to use:`;
                if (titleMismatch) {
                    statusMessage = `⚠️ *Title Mismatch:* I found "${match.title}" (${match.year}) for the IMDb ID \`${imdbId}\`, but you mentioned "${title}". Should I proceed with "${match.title}" using these settings?`;
                }

                return {
                    confirmationRequired: true,
                    message: statusMessage,
                    availableProfiles: profiles.map(p => ({ id: p.id, name: p.name })),
                    availableFolders: folders.map(f => ({ path: f.path, freeSpace: (f.freeSpace / 1024 / 1024 / 1024).toFixed(1) + " GB" })),
                    mediaDetails: {
                        title: match.title,
                        year: match.year,
                        overview: match.overview,
                        posterUrl: match.images?.find(i => i.coverType === "poster")?.remoteUrl || match.images?.find(i => i.coverType === "poster")?.url,
                        tmdbId: match.tmdbId,
                    },
                    buttons: [
                        { text: "✅ Yes, Add Movie", data: `add movie ${match.tmdbId} ${defaultProfile?.id}` },
                        { text: "❌ Cancel", data: "cancel add movie" }
                    ]
                } as any;
            }

            // Final addition using specified or default settings
            const finalProfileId = qualityProfileId ?? defaultProfile?.id;
            const finalFolderPath = rootFolderPath ?? folders[0]?.path;

            if (finalProfileId === undefined || finalFolderPath === undefined) {
                return { message: "Error: Could not determine quality profile or root folder for Radarr addition." } as any;
            }

            const result = await radarr.addMovie(normalizedTmdbId, match.title, match.year, finalFolderPath, finalProfileId);
            return {
                success: true,
                message: `Successfully added '${result.title}' to Radarr.`,
                tmdbId: normalizedTmdbId,
                title: result.title
            };
        } catch (_error: any) {
            return {
                message: "Radarr rejected that add request. Please check if the movie is already in your library.",
            } as any;
        }
    },
});

export const getMovieQueueTool = tool({
    description: "Get the current queue of movies downloading in Radarr.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        try {
            const queue = await radarr.getMovieQueue();
            if (queue.length === 0) {
                return { message: "The Radarr download queue is currently empty." };
            }
            return queue.map(q => ({
                title: q.title,
                sizeTotal: q.size,
                sizeLeft: q.sizeleft,
            })) as any;
        } catch (error: any) {
            return { message: `Failed to fetch Radarr queue: ${error.message || "Unknown error"}` };
        }
    },
});

export const removeMovieTool = tool({
    description: "Remove a MOVIE from Radarr. Requires the TMDB ID from a previous search. This tool will first return the match details and ask for confirmation along with a choice to delete or keep the actual media files, unless 'confirm' is true.",
    parameters: z.object({
        tmdbId: z.union([z.number(), z.string().transform(Number)]).describe("The TMDB ID of the movie to remove."),
        deleteFiles: z.boolean().default(false).describe("Whether to delete the downloaded media files as well."),
        confirm: z.boolean().default(false).describe("Set to true ONLY when the user has explicitly confirmed the removal and the file deletion choice."),
    }),
    execute: async ({ tmdbId, deleteFiles, confirm }: { tmdbId: number, deleteFiles: boolean, confirm: boolean }) => {
        try {
            const results = await radarr.searchMovie(`tmdb:${tmdbId}`);
            const match = results.find(m => m.tmdbId === Number(tmdbId));
            if (!match || !match.id) {
                return { message: `Could not find a movie in Radarr with TMDB ID ${tmdbId}.` };
            }

            if (!confirm) {
                return {
                    message: `Found movie: '${match.title} (${match.year})'. Path: ${match.path || "N/A"}.\n\n⚠️ Are you sure you want to remove it? Please confirm and specify if you want to **DELETE THE MEDIA FILES** or keep them safely.`,
                    item: {
                        title: match.title,
                        year: match.year,
                        tmdbId: match.tmdbId,
                        path: match.path
                    },
                    requiresConfirmation: true,
                    buttons: [
                        { text: "✅ Remove from Radarr only", data: "Remove the movie but keep the files" },
                        { text: "🗑️ Remove and DELETE files", data: "Remove the movie and delete the files" }
                    ]
                };
            }

            await radarr.deleteMovie(match.id, deleteFiles);
            return {
                success: true,
                message: `Successfully removed '${match.title}' from Radarr. Files deleted: ${deleteFiles}.`
            };
        } catch (error: any) {
            return { message: `Failed to remove movie: ${error.message || "Unknown error"}` };
        }
    },
});

// --- Sonarr Tools --- //

export const searchSeriesTool = tool({
    description: "Search for a TV series in Sonarr to get its TVDB ID. USE THIS ONLY ONLY when searching for a SPECIFIC SERIES TITLE. Do NOT use this for queries like 'Japanese series', 'Spanish shows', or genre-based queries.",
    parameters: z.object({
        term: z.string().describe("The name of the TV show to search for (e.g., 'The Boys'). Do NOT include country names or genres here."),
    }),
    execute: async ({ term }: any) => {
        const results = await sonarr.searchSeries(term);
        return results.slice(0, 5).map(s => ({
            title: s.title,
            mediaType: "[Show]",
            originalTitle: s.originalTitle,
            year: s.year,
            genres: s.genres,
            tvdbId: s.tvdbId,
            imdbId: s.imdbId,
            overview: s.overview,
            posterUrl: s.images?.find(i => i.coverType === "poster")?.remoteUrl || s.images?.find(i => i.coverType === "poster")?.url,
            network: s.network,
            monitored: s.monitored,
            ratings: s.ratings,
        })) as any;
    },
});

export const addSeriesTool = tool({
    description: "Add a TV SERIES/SHOW to Sonarr to begin downloading it. Requires the TVDB ID from a previous search. Do NOT use this for movies. This tool will first return details and available configuration options (profiles, folders) for confirmation unless 'confirm' is true.",
    parameters: z.object({
        tvdbId: z.union([z.number(), z.string().transform(Number)]).nullable().describe("The TVDB ID of the series."),
        title: z.string().describe("The title of the series."),
        imdbId: z.string().optional().describe("The IMDb ID of the series (e.g., 'tt0111161')."),
        qualityProfileId: z.number().optional().describe("The ID of the quality profile to use."),
        languageProfileId: z.number().optional().describe("The ID of the language profile to use."),
        rootFolderPath: z.string().optional().describe("The root folder path for the series."),
        confirm: z.boolean().default(false).describe("Set to true ONLY when the user has explicitly confirmed the specific match and settings (folder, profile)."),
    }),
    execute: async ({ tvdbId, title, imdbId, qualityProfileId, languageProfileId, rootFolderPath, confirm }: { tvdbId: number | null, title: string, imdbId?: string, qualityProfileId?: number, languageProfileId?: number, rootFolderPath?: string, confirm: boolean }) => {
        let normalizedTvdbId = (tvdbId !== null && tvdbId !== undefined) ? Number(tvdbId) : 0;

        let imdbMatch: any = null;
        if (imdbId) {
            try {
                const results = await sonarr.searchSeries(imdbId);
                imdbMatch = results[0];
                if (imdbMatch) {
                    normalizedTvdbId = imdbMatch.tvdbId;
                }
            } catch (err) {
                console.warn(`⚠️ IMDb search failed for ${imdbId}:`, (err as Error).message);
            }
        }

        if (normalizedTvdbId <= 0) {
            const results = await sonarr.searchSeries(title);
            return {
                message: "Missing TVDB ID. Please choose the correct series first.",
                suggestions: results.slice(0, 5).map(s => ({
                    title: s.title,
                    originalTitle: s.originalTitle,
                    year: s.year,
                    genres: s.genres,
                    tvdbId: s.tvdbId,
                    imdbId: s.imdbId,
                    overview: s.overview,
                    posterUrl: s.images?.find(i => i.coverType === "poster")?.remoteUrl || s.images?.find(i => i.coverType === "poster")?.url,
                })),
            } as any;
        }

        const [profiles, languageProfiles, folders] = await Promise.all([
            withCache("sonarr_profiles", () => sonarr.getQualityProfiles()),
            withCache("sonarr_languages", () => sonarr.getLanguageProfiles()),
            withCache("sonarr_folders", () => sonarr.getRootFolders())
        ]);

        if (profiles.length === 0 || languageProfiles.length === 0 || folders.length === 0) {
            return { message: "Cannot add series: missing profiles or root folders in Sonarr." } as any;
        }

        // Try to get exact series details using TVDB ID directly
        let exactSeries = await sonarr.getSeriesByTvdbId(normalizedTvdbId);

        // Fallback to title search if ID lookup fails
        if (!exactSeries) {
            const seriesDetails = await sonarr.searchSeries(title);
            exactSeries = seriesDetails.find(s => s.tvdbId === normalizedTvdbId);
        }

        if (!exactSeries) {
            return {
                message: `Could not fetch details for series "${title}" (TVDB ID: ${normalizedTvdbId}). Please try searching for the series by name again to refresh the IDs.`,
            } as any;
        }

        const titleMismatch = imdbMatch && stripDiacritics(exactSeries.title.toLowerCase()) !== stripDiacritics(title.toLowerCase());

        const defaultProfile = getDefaultQualityProfile(profiles);
        const defaultLanguage = getDefaultLanguageProfile(languageProfiles);

        if (!confirm || titleMismatch) {
            let statusMessage = `I found "${exactSeries.title}" (${exactSeries.year}). Please confirm if I should add it and which settings to use:`;
            if (titleMismatch) {
                statusMessage = `⚠️ *Title Mismatch:* I found "${exactSeries.title}" (${exactSeries.year}) for the IMDb ID \`${imdbId}\`, but you mentioned "${title}". Should I proceed with "${exactSeries.title}" using these settings?`;
            }

            return {
                confirmationRequired: true,
                message: statusMessage,
                availableProfiles: profiles.map(p => ({ id: p.id, name: p.name })),
                availableLanguages: languageProfiles.map(l => ({ id: l.id, name: l.name })),
                availableFolders: folders.map(f => ({ path: f.path, freeSpace: (f.freeSpace / 1024 / 1024 / 1024).toFixed(1) + " GB" })),
                mediaDetails: {
                    title: exactSeries.title,
                    year: exactSeries.year,
                    overview: exactSeries.overview,
                    posterUrl: exactSeries.images?.find(i => i.coverType === "poster")?.remoteUrl || exactSeries.images?.find(i => i.coverType === "poster")?.url,
                    tvdbId: exactSeries.tvdbId,
                    network: exactSeries.network,
                    seasons: exactSeries.seasons?.length || 0,
                    genres: exactSeries.genres,
                },
                buttons: [
                    { text: "✅ Yes, Add Series", data: `add series ${exactSeries.tvdbId} ${defaultProfile?.id}` },
                    { text: "❌ Cancel", data: "cancel add series" }
                ]
            } as any;
        }

        // Use specified or default settings
        const finalProfileId = qualityProfileId ?? defaultProfile?.id;
        const finalLanguageId = languageProfileId ?? defaultLanguage?.id;
        const finalFolderPath = rootFolderPath ?? folders[0]?.path;

        if (!finalProfileId || !finalLanguageId || !finalFolderPath) {
            return { message: "Error: Could not retrieve base Sonarr configuration (profile, language, or root settings)." } as any;
        }

        // Monitor all seasons by default
        const seasons = exactSeries.seasons?.map(s => ({ seasonNumber: s.seasonNumber, monitored: true })) || [];

        // Anime Detection
        const isAnime = exactSeries.genres?.some(g => g.toLowerCase() === "anime") ||
            (exactSeries.genres?.some(g => g.toLowerCase() === "animation") &&
                exactSeries.genres?.some(g => ["action", "adventure", "fantasy"].includes(g.toLowerCase())));

        const seriesType = isAnime ? "anime" : "standard";

        await sonarr.addSeries(normalizedTvdbId, exactSeries.title, finalProfileId, finalLanguageId, finalFolderPath, seasons, seriesType);

        return {
            success: true,
            message: `Successfully added '${exactSeries.title}' to Sonarr as ${seriesType} series.`,
            tvdbId: normalizedTvdbId,
            title: exactSeries.title
        };
    },
});

export const getSeriesQueueTool = tool({
    description: "Get the current queue of TV shows downloading in Sonarr.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        try {
            const queue = await sonarr.getSeriesQueue();
            if (queue.length === 0) {
                return { message: "The Sonarr download queue is currently empty." };
            }
            return queue.map(q => ({
                title: q.title,
                sizeTotal: q.size,
                sizeLeft: q.sizeleft,
            })) as any;
        } catch (error: any) {
            return { message: `Failed to fetch Sonarr queue: ${error.message || "Unknown error"}` };
        }
    },
});

export const removeSeriesTool = tool({
    description: "Remove a TV SERIES from Sonarr. Requires the TVDB ID from a previous search. This tool will first return the match details and ask for confirmation along with a choice to delete or keep the actual media files, unless 'confirm' is true.",
    parameters: z.object({
        tvdbId: z.union([z.number(), z.string().transform(Number)]).describe("The TVDB ID of the series to remove."),
        deleteFiles: z.boolean().default(false).describe("Whether to delete the downloaded media files as well."),
        confirm: z.boolean().default(false).describe("Set to true ONLY when the user has explicitly confirmed the removal and the file deletion choice."),
    }),
    execute: async ({ tvdbId, deleteFiles, confirm }: { tvdbId: number, deleteFiles: boolean, confirm: boolean }) => {
        try {
            const match = await sonarr.getSeriesByTvdbId(Number(tvdbId));
            if (!match || !match.id) {
                return { message: `Could not find a series in Sonarr with TVDB ID ${tvdbId}.` };
            }

            if (!confirm) {
                return {
                    message: `Found series: '${match.title} (${match.year})'. Path: ${match.path || "N/A"}.\n\n⚠️ Are you sure you want to remove it? Please confirm and specify if you want to **DELETE THE MEDIA FILES** or keep them safely.`,
                    item: {
                        title: match.title,
                        year: match.year,
                        tvdbId: match.tvdbId,
                        path: match.path
                    },
                    requiresConfirmation: true,
                    buttons: [
                        { text: "✅ Remove from Sonarr only", data: "Remove the series but keep the files" },
                        { text: "🗑️ Remove and DELETE files", data: "Remove the series and delete the files" }
                    ]
                };
            }

            await sonarr.deleteSeries(match.id, deleteFiles);
            return {
                success: true,
                message: `Successfully removed '${match.title}' from Sonarr. Files deleted: ${deleteFiles}.`
            };
        } catch (error: any) {
            return { message: `Failed to remove series: ${error.message || "Unknown error"}` };
        }
    },
});

// --- qBittorrent Tools --- //

export const getTorrentsTool = tool({
    description: "Get a list of active torrents downloading or seeding in qBittorrent.",
    parameters: z.object({
        filter: z.enum(["all", "downloading", "seeding", "paused", "active"]).optional().describe("Filter for the list of torrents."),
    }),
    execute: async ({ filter = "downloading" }: { filter?: string }) => {
        try {
            const torrents = await qbittorrent.getTorrents(filter);
            if (torrents.length === 0) {
                return { message: `No torrents found with filter: ${filter}` };
            }
            return torrents.map(t => ({
                name: t.name,
                hash: t.hash,
                progress: (t.progress * 100).toFixed(2) + "%",
                etaSeconds: t.eta,
                state: t.state,
                dlspeed: (t.dlspeed / 1024 / 1024).toFixed(2) + " MB/s" // Convert bytes to MB/s
            }));
        } catch (error: any) {
            return { message: `Failed to fetch torrents from qBittorrent: ${error.message || "Unknown error"}` };
        }
    },
});

export const pauseTorrentTool = tool({
    description: "Pause a specific torrent by its hash.",
    parameters: z.object({
        hash: z.string().describe("The hash of the torrent to pause."),
    }),
    execute: async ({ hash }: { hash: string }) => {
        try {
            await qbittorrent.pauseTorrent(hash);
            return { message: `Successfully paused torrent with hash ${hash}` };
        } catch (error: any) {
            return { message: `Failed to pause torrent: ${error.message || "Unknown error"}` };
        }
    },
});

export const resumeTorrentTool = tool({
    description: "Resume a specific torrent by its hash.",
    parameters: z.object({
        hash: z.string().describe("The hash of the torrent to resume."),
    }),
    execute: async ({ hash }: { hash: string }) => {
        try {
            await qbittorrent.resumeTorrent(hash);
            return { message: `Successfully resumed torrent with hash ${hash}` };
        } catch (error: any) {
            return { message: `Failed to resume torrent: ${error.message || "Unknown error"}` };
        }
    },
});

// --- NZBGet Tools --- //

export const getNZBGetQueueTool = tool({
    description: "Get the current download queue from NZBGet, including speed and ETA for active downloads.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        try {
            const [queue, status] = await Promise.all([
                nzbget.getQueue(),
                nzbget.getStatus()
            ]);

            if (queue && queue.length === 0) {
                return { message: "The NZBGet queue is empty." };
            }

            const activeDownloads = queue.map((q: any) => ({
                nzbName: q.NZBName,
                fileSize: (q.FileSizeMB).toFixed(2) + " MB",
                remainingSize: (q.RemainingSizeMB).toFixed(2) + " MB",
                percentage: q.PercentageSuccess + "%",
                status: q.Status
            }));

            return {
                activeDownloads,
                globalStatus: {
                    downloadRate: (status.DownloadRate / 1024 / 1024).toFixed(2) + " MB/s",
                    remainingSize: (status.RemainingSizeMB).toFixed(2) + " MB",
                    eta: status.RemainingSizeMB > 0 ? status.ETA : "N/A",
                    isPaused: status.DownloadPaused
                }
            };
        } catch (error: any) {
            return { message: `Failed to fetch NZBGet status: ${error.message}` };
        }
    },
});

// --- Plex Tools --- //

export const searchPlexByTitleOnlyTool = tool({
    description: "Search the local Plex library to see if a movie or show already exists BY TITLE ONLY. DO NOT use this for genre or country queries.",
    parameters: z.object({
        query: z.string().describe("The name of the movie or show to search for in Plex."),
    }),
    execute: async ({ query }: { query: string }) => {
        const normalizedQuery = String(query ?? "").trim();
        if (!normalizedQuery) {
            return { message: "Please provide a title to search for in Plex." } as any;
        }

        const attemptQueries = uniqueNonEmptyStrings([
            normalizedQuery,
            stripDiacritics(normalizedQuery),
        ]);

        const allResults: any[] = [];

        const runPlexSearch = async (q: string) => {
            const result = await plex.searchPlex(q);
            if (result.Metadata && result.Metadata.length > 0) {
                allResults.push(...result.Metadata);
            }
        };

        for (const q of attemptQueries) {
            await runPlexSearch(q);
        }

        // Multilingual fallback: resolve candidate canonical titles via Radarr/Sonarr (TMDB/TVDB),
        // then retry Plex searches with English + original titles.
        if (allResults.length === 0) {
            const fallbackQueries: string[] = [];

            try {
                const radarrMatches = await radarr.searchMovie(normalizedQuery);
                for (const match of radarrMatches.slice(0, 3)) {
                    fallbackQueries.push(match.title);
                    if (match.originalTitle) fallbackQueries.push(match.originalTitle);
                }
            } catch {
                // Best-effort only.
            }

            try {
                const sonarrMatches = await sonarr.searchSeries(normalizedQuery);
                for (const match of sonarrMatches.slice(0, 3)) {
                    fallbackQueries.push(match.title);
                    if (match.originalTitle) fallbackQueries.push(match.originalTitle);
                }
            } catch {
                // Best-effort only.
            }

            const uniqueFallbackQueries = uniqueNonEmptyStrings([
                ...fallbackQueries,
                ...fallbackQueries.map((q) => stripDiacritics(q)),
            ]);

            for (const q of uniqueFallbackQueries) {
                await runPlexSearch(q);
            }
        }

        const uniqueResults = deduplicatePlexItems(allResults);
        if (uniqueResults.length === 0) {
            return { message: `No results found in Plex library for '${normalizedQuery}'.` } as any;
        }

        const items = uniqueResults.slice(0, 5);
        return (await Promise.all(items.map(async (m) => {
            // Extract IDs from GUID if possible (e.g. com.plexapp.agents.imdb://tt12345)
            const imdbMatch = m.guid?.match(/imdb:\/\/(tt\d+)/);
            const tmdbMatch = m.guid?.match(/tmdb:\/\/(\d+)/);
            const countries = m.ratingKey ? await plex.getItemCountryTags(String(m.ratingKey)) : [];

            return {
                title: m.title,
                type: m.type,
                mediaType: m.type === "movie" ? "[Movie]" : m.type === "show" ? "[Show]" : `[${m.type}]`,
                year: m.year,
                overview: m.summary,
                imdbId: imdbMatch ? imdbMatch[1] : undefined,
                tmdbId: tmdbMatch ? tmdbMatch[1] : undefined,
                originalTitle: m.originalTitle,
                countries,
                primaryCountry: countries[0],
                posterUrl: plex.getPosterUrl(m.thumb),
            };
        }))) as any;
    },
});

export const browsePlexByGenreTool = tool({
    description: "Find movies or shows in the Plex library that match a specific genre (e.g., Horror, Comedy).",
    parameters: z.object({
        genre: z.string().describe("The genre to browse for."),
    }),
    execute: async ({ genre }: { genre: string }) => {
        const sectionIds = await plex.getAllSectionIds();

        if (sectionIds.length === 0) {
            return { message: "Could not find any 'movie' or 'show' sections in your Plex library." };
        }

        const allResults: any[] = [];
        for (const sectionId of sectionIds) {
            try {
                const result = await plex.getItemsByGenre(sectionId, genre);
                if (result.Metadata) {
                    allResults.push(...result.Metadata);
                }
            } catch (error) {
                console.error(`Error browsing section ${sectionId} for genre ${genre}:`, error);
            }
        }

        const uniqueResults = deduplicatePlexItems(allResults);

        if (uniqueResults.length === 0) {
            return {
                totalFound: 0,
                sampleItems: [],
                message: `No items found in your Plex library for genre '${genre}' across checked sections (${sectionIds.join(", ")}).`,
            } as any;
        }

        return {
            totalFound: uniqueResults.length,
            queryType: "genre",
            searchParam: genre,
            sampleItems: uniqueResults.slice(0, 15).map(m => ({
                title: m.title,
                mediaType: m.type === "movie" ? "[Movie]" : m.type === "show" ? "[Show]" : `[${m.type}]`,
                originalTitle: m.originalTitle,
                year: m.year,
                overview: m.summary,
                posterUrl: plex.getPosterUrl(m.thumb),
            })),
        } as any;
    },
});

export const getRecentlyAddedPlexTool = tool({
    description: "Get the recently added movies or shows in the Plex library.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        const result = await plex.getRecentlyAdded();
        if (!result.Metadata || result.Metadata.length === 0) {
            return { message: "No recently added items found in Plex." };
        }
        return result.Metadata.slice(0, 5).map(m => ({
            title: m.grandparentTitle ? `${m.grandparentTitle} - ${m.title}` : m.title,
            type: m.type,
        })) as any;
    },
});

// --- System & Audit Tools --- //

export const checkServiceHealthTool = tool({
    description: "Check if a specific service (Radarr, Sonarr, qBittorrent, or Plex, or NZBGet) is online and responsive.",
    parameters: z.object({
        service: z.string().describe("The service to check health for (e.g., Radarr, Sonarr, qBittorrent, Plex, Jellyfin, NZBGet)."),
    }),
    execute: async ({ service }: { service: string }) => {
        try {
            if (service === "Radarr") await radarr.getSystemStatus();
            else if (service === "Sonarr") await sonarr.getSystemStatus();
            else if (service === "Plex") await plex.getSystemStatus();
            else if (service === "qBittorrent") await qbittorrent.getTorrents("all");
            else if (service === "NZBGet") {
                const nzbget = await import("../services/nzbget");
                await nzbget.getVersion();
            }
            else {
                return {
                    online: false,
                    message: `Service '${service}' is not currently configured or supported for health checks. Supported services are: Radarr, Sonarr, qBittorrent, Plex, and NZBGet.`
                };
            }
            return { online: true, message: `${service} is online and responsive.` };
        } catch (error) {
            return { online: false, message: `${service} appears to be offline or unreachable.` };
        }
    },
});

export const getMissingMoviesTool = tool({
    description: "Get a list of movies that are monitored in Radarr but are missing from the disk.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        const missing = await radarr.getMissingMovies();
        if (missing.length === 0) return { message: "No missing movies found in Radarr." };
        return {
            totalMissing: missing.length,
            sample: missing.slice(0, 10).map(m => ({ title: m.title, year: m.year }))
        };
    },
});

export const getMissingSeriesTool = tool({
    description: "Get a list of TV shows in Sonarr that are missing episodes.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        const missing = await sonarr.getMissingSeries();
        if (missing.length === 0) return { message: "No series with missing episodes found in Sonarr." };
        return {
            totalMissingSeries: missing.length,
            sample: missing.slice(0, 10).map(s => ({
                title: s.title,
                percentDone: (s.statistics?.percentOfEpisodes ?? 0).toFixed(1) + "%"
            }))
        };
    },
});

export const getMissingEpisodesTool = tool({
    description: "Get a detailed list of specific missing TV episodes in Sonarr, including season, episode number, and release date.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        const result = await sonarr.getMissingEpisodes();
        if (result.totalRecords === 0) return { message: "No missing episodes found in Sonarr." };
        return {
            totalMissingEpisodes: result.totalRecords,
            sample: result.records.slice(0, 15).map((e: any) => ({
                seriesTitle: e.series?.title,
                season: e.seasonNumber,
                episode: e.episodeNumber,
                airDate: e.airDate,
            }))
        };
    },
});

export const discoverMediaTool = tool({
    description: "Discover critically acclaimed or top-rated movies and shows using TMDB. Useful for when the user asks for recommendations, especially recent releases.",
    parameters: z.object({
        query: z.string().describe("The search query for discovery (e.g., 'comedy movies 2025', 'thriller series 2026', 'best drama 2025')."),
    }),
    execute: async ({ query }: { query: string }) => {
        try {
            const tmdb = await import("../services/tmdb");
            const results = await tmdb.discoverMedia(query, 10);

            if (results.length === 0) {
                return {
                    message: `No TMDB results found for '${query}'.`,
                    suggestions: [],
                    note: "Try broadening the query (e.g. remove year constraint) or use 'searchMovie'/'searchSeries' directly with a title you know.",
                };
            }

            return {
                message: `Found ${results.length} results from TMDB for '${query}'.`,
                suggestions: results.map((r) => ({
                    title: r.title,
                    year: r.year,
                    type: r.mediaType,
                    rating: r.rating,
                    voteCount: r.voteCount,
                    genres: r.genres,
                    overview: r.overview.slice(0, 200) + (r.overview.length > 200 ? "…" : ""),
                    posterUrl: r.posterPath ? `https://image.tmdb.org/t/p/w500${r.posterPath}` : null,
                })),
                note: "Use 'searchMovie' or 'searchSeries' with the exact title to check availability or add to the download queue.",
            };
        } catch (err: any) {
            console.error("discoverMediaTool TMDB error:", err?.message ?? err);
            return {
                message: `Could not reach TMDB for '${query}'.`,
                suggestions: [],
                note: err?.message ?? "Unknown error. Check TMDB_READ_ACCESS_TOKEN in your environment.",
            };
        }
    },
});

export const findPlexByCountryTool = tool({
    description: "Find movies or shows in the Plex library that match a specific country of origin (e.g., Japan, France, USA). Use this for ANY query involving a country or nationality, such as 'Japanese series', 'French movies', 'films from Italy', or 'Japanese schoolgirls'.",
    parameters: z.object({
        country: z.string().transform((value) => plex.normalizeCountryName(value)).describe("The country to browse for as a noun or adjective (e.g., Germany, French, Japan, Japanese)."),
        ranked: z.boolean().optional().describe("Set to true when the user asks for top/best/ranked movies."),
        limit: z.number().int().min(1).max(25).nullable().optional().describe("How many items to return in sampleItems (e.g., top 10)."),
    }),
    execute: async ({ country, ranked = false, limit }: { country: string, ranked?: boolean, limit?: number | null }) => {
        const effectiveLimit = limit ?? 15;
        const sectionIds = await plex.getAllSectionIds();

        if (sectionIds.length === 0) {
            return { message: "Could not find any 'movie' or 'show' sections in your Plex library." };
        }

        const allResults: any[] = [];
        for (const sectionId of sectionIds) {
            try {
                const result = await plex.getItemsByCountry(sectionId, country);
                if (result.Metadata) {
                    allResults.push(...result.Metadata);
                }
            } catch (error) {
                console.error(`Error browsing section ${sectionId} for country ${country}:`, error);
            }
        }

        const uniqueResults = deduplicatePlexItems(allResults);
        const strictCountryResults = await plex.filterItemsByCountryTag(uniqueResults, country, { primaryOnly: false });

        if (strictCountryResults.length === 0) {
            return {
                totalFound: 0,
                sampleItems: [],
                message: `No items found in your Plex library for country '${country}' across checked sections.`,
            } as any;
        }

        const rankScore = (item: any): number => {
            if (typeof item?.rating === "number" && Number.isFinite(item.rating)) return item.rating;
            if (typeof item?.audienceRating === "number" && Number.isFinite(item.audienceRating)) return item.audienceRating;
            if (typeof item?.userRating === "number" && Number.isFinite(item.userRating)) return item.userRating;
            return Number.NEGATIVE_INFINITY;
        };

        const orderedResults = ranked
            ? [...strictCountryResults].sort((a, b) => rankScore(b) - rankScore(a))
            : strictCountryResults;

        const sampleItems = await Promise.all(orderedResults.slice(0, effectiveLimit).map(async (m) => {
            let enrichedOriginalTitle = m.originalTitle;
            let aliasTitle = typeof m.titleSort === "string" ? m.titleSort.trim() : undefined;

            if (m.ratingKey) {
                try {
                    const details = await plex.getItemMetadata(String(m.ratingKey));
                    const detailOriginalTitle = typeof details?.originalTitle === "string" ? details.originalTitle.trim() : "";
                    const detailTitleSort = typeof details?.titleSort === "string" ? details.titleSort.trim() : "";
                    if (detailOriginalTitle) {
                        enrichedOriginalTitle = detailOriginalTitle;
                    }
                    if (detailTitleSort) aliasTitle = detailTitleSort;
                } catch {
                    // Best-effort enrichment only.
                }
            }

            const currentTitle = String(m.title || "").trim();
            const currentAlias = pickLatinAliasCandidate([enrichedOriginalTitle, aliasTitle], currentTitle);
            if (currentTitle && hasNonLatinCharacters(currentTitle) && !currentAlias) {
                try {
                    const lookup = await radarr.searchMovie(currentTitle);
                    const yearMatch = lookup.find((item) => item.year === m.year) || lookup[0];
                    if (yearMatch) {
                        const radarrAlias = pickLatinAliasCandidate(
                            [yearMatch.originalTitle, yearMatch.title],
                            currentTitle
                        );
                        if (radarrAlias) {
                            aliasTitle = radarrAlias;
                        }
                    }
                } catch {
                    // Best-effort alias enrichment only.
                }
            }

            return {
                title: m.title,
                mediaType: m.type === "movie" ? "[Movie]" : m.type === "show" ? "[Show]" : `[${m.type}]`,
                originalTitle: enrichedOriginalTitle,
                aliasTitle,
                year: m.year,
                overview: m.summary,
                posterUrl: plex.getPosterUrl(m.thumb),
            };
        }));

        return {
            totalFound: strictCountryResults.length,
            ranked,
            requestedLimit: limit,
            queryType: "country",
            searchParam: country,
            sampleItems,
        } as any;
    },
});


export const searchPlexByDurationTool = tool({
    description: "Find MOVIES in Plex that match a specific duration. Useful when the user asks for 'short movies under X minutes'. This tool only searches movie libraries.",
    parameters: z.object({
        comparison: z.enum(["shorterThan", "longerThan", "between"]).describe("How to compare the duration."),
        minutes: z.number().int().min(1).describe("The duration in minutes for comparison (max value for 'shorterThan', min value for 'longerThan')."),
        minutesMax: z.number().int().min(1).optional().describe("Maximum duration for 'between' comparison."),
        limit: z.number().int().min(1).max(50).nullable().optional().describe("How many items to return in sampleItems (e.g., top 10)."),
    }),
    execute: async ({ comparison, minutes, minutesMax, limit }: { comparison: string, minutes: number, minutesMax?: number, limit?: number | null }) => {
        let sectionIds = plex.getMovieSectionIds();

        if (sectionIds.length === 0) {
            const sections = await plex.getLibrarySections();
            sectionIds = (sections.Directory as any[])
                ?.filter(d => d.type === "movie")
                .map(d => d.key) || [];
        }

        if (sectionIds.length === 0) {
            return { message: "Could not find any 'movie' sections in your Plex library." };
        }

        const allResults: any[] = [];
        for (const sectionId of sectionIds) {
            try {
                // Get all movies from the section - Plex returns duration in milliseconds
                // Use the correct endpoint to fetch items from a section
                const itemsResult = await plex.getItemsByDuration(sectionId);

                if (itemsResult && itemsResult.Metadata) {
                    for (const item of itemsResult.Metadata) {
                        if (item.duration) {
                            const durationMinutes = Math.round(item.duration / 60000);
                            let matches = false;

                            if (comparison === "shorterThan" && durationMinutes < minutes) {
                                matches = true;
                            } else if (comparison === "longerThan" && durationMinutes > minutes) {
                                matches = true;
                            } else if (comparison === "between" && minutesMax && durationMinutes >= minutes && durationMinutes <= minutesMax) {
                                matches = true;
                            }

                            if (matches) {
                                allResults.push({
                                    ...item,
                                    durationMinutes
                                });
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Error searching section ${sectionId} by duration:`, error);
            }
        }

        const uniqueResults = deduplicatePlexItems(allResults);

        if (uniqueResults.length === 0) {
            let queryDesc = "";
            if (comparison === "shorterThan") {
                queryDesc = `shorter than ${minutes} minutes`;
            } else if (comparison === "longerThan") {
                queryDesc = `longer than ${minutes} minutes`;
            } else if (comparison === "between" && minutesMax) {
                queryDesc = `between ${minutes} and ${minutesMax} minutes`;
            }
            return {
                totalFound: 0,
                sampleItems: [],
                message: `No movies found in your Plex library ${queryDesc}.`
            } as any;
        }

        // Sort by duration
        const sortedResults = [...uniqueResults].sort((a, b) => {
            const aDuration = a.durationMinutes ?? 0;
            const bDuration = b.durationMinutes ?? 0;
            return comparison === "shorterThan"
                ? aDuration - bDuration
                : bDuration - aDuration;
        });

        const effectiveLimit = limit ?? 10;
        const sampleItems = sortedResults.slice(0, effectiveLimit).map(m => ({
            title: m.title,
            originalTitle: m.originalTitle,
            year: m.year,
            duration: m.durationMinutes,
            overview: m.summary,
            posterUrl: plex.getPosterUrl(m.thumb),
        }));

        let queryDesc = "";
        if (comparison === "shorterThan") {
            queryDesc = `shorter than ${minutes} minutes`;
        } else if (comparison === "longerThan") {
            queryDesc = `longer than ${minutes} minutes`;
        } else if (comparison === "between" && minutesMax) {
            queryDesc = `between ${minutes} and ${minutesMax} minutes`;
        }

        return {
            totalFound: uniqueResults.length,
            queryType: "duration",
            searchParam: queryDesc,
            sampleItems,
        } as any;
    },
});

export const getPlexLibraryStatsTool = tool({
    description: "Get statistics about the Plex library, summarizing content by section type across all library sections.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        const sections = await plex.getLibrarySections();
        if (!sections.Directory || sections.Directory.length === 0) {
            return { totalMovies: 0, totalShows: 0, message: "No library sections found in Plex." };
        }

        const counts = await Promise.all((sections.Directory as any[]).map(async (d) => {
            const size = await plex.getLibrarySize(d.key);
            return { type: d.type, size };
        }));

        const totalMovies = counts.filter(c => c.type === "movie").reduce((acc, c) => acc + c.size, 0);
        const totalShows = counts.filter(c => c.type === "show").reduce((acc, c) => acc + c.size, 0);

        return {
            totalMovies,
            totalShows,
            message: `You have ${totalMovies} movies and ${totalShows} TV shows in your Plex library across all ${sections.Directory.length} sections.`
        };
    },
});

export const getUnwatchedEpisodesTool = tool({
    description: "Get a list of unwatched episodes for a specific series in Plex. Requires the Plex 'ratingKey' of the series, which can be obtained by searching with 'searchPlexByTitleOnly'.",
    parameters: z.object({
        seriesRatingKey: z.string().describe("The Plex ratingKey of the series."),
    }),
    execute: async ({ seriesRatingKey }: { seriesRatingKey: string }) => {
        try {
            const episodes = await plex.getUnwatchedEpisodes(seriesRatingKey);
            if (episodes.length === 0) {
                return { message: "No unwatched episodes found for this series." };
            }

            return {
                totalFound: episodes.length,
                episodes: episodes.map(e => ({
                    title: e.title,
                    season: e.parentIndex,
                    episode: e.index,
                    summary: e.summary,
                })),
            };
        } catch (error: any) {
            return { message: `Failed to fetch unwatched episodes: ${error.message || "Unknown error"}` };
        }
    },
});

export const subscribeToDownloadTool = tool({
    description: "Subscribe a user to receive a Telegram notification when a specific movie or series download finishes. Use this ONLY after the user has confirmed they want to be notified.",
    parameters: z.object({
        userId: z.number().describe("The Telegram user ID of the person to notify."),
        mediaType: z.enum(["movie", "series"]).describe("The type of media (movie or series)."),
        mediaId: z.number().describe("The TMDB ID (for movies) or TVDB ID (for series)."),
        title: z.string().describe("The title of the media item."),
    }),
    execute: async ({ userId, mediaType, mediaId, title }: { userId: number, mediaType: 'movie' | 'series', mediaId: number, title: string }) => {
        try {
            db.savePendingNotification(userId, mediaType, mediaId, title);
            return {
                success: true,
                message: `Perfect! I'll send you a Telegram message as soon as '${title}' finishes downloading. 📡🎬`
            };
        } catch (error: any) {
            return { message: `Failed to register notification request: ${error.message || "Unknown error"}` };
        }
    },
});
