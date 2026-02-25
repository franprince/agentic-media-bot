import { tool } from "ai";
import { z } from "zod";
import * as radarr from "../services/radarr";
import * as sonarr from "../services/sonarr";
import * as qbittorrent from "../services/qbittorrent";
import * as plex from "../services/plex";

// --- Radarr Tools --- //

export const searchMovieTool = tool({
    description: "Search for a movie in Radarr to get its details, like TMDB ID, year, and if it's already downloaded.",
    parameters: z.object({
        term: z.string().describe("The name of the movie to search for."),
    }),
    execute: async ({ term }: { term: string }) => {
        const results = await radarr.searchMovie(term);
        // Limit results to avoid massive context payloads
        return results.slice(0, 5).map(m => ({
            title: m.title,
            year: m.year,
            tmdbId: m.tmdbId,
            hasFile: m.hasFile,
            monitored: m.monitored,
        })) as any;
    },
});

export const addMovieTool = tool({
    description: "Add a movie to Radarr to begin downloading it. Requires the TMDB ID from a previous search.",
    parameters: z.object({
        tmdbId: z.number().describe("The TMDB ID of the movie to add."),
        title: z.string().describe("The title of the movie."),
        year: z.number().describe("The release year of the movie."),
    }),
    execute: async ({ tmdbId, title, year }: { tmdbId: number, title: string, year: number }) => {
        // Fetch required configuration dynamically to ensure we add it correctly
        const [profiles, folders] = await Promise.all([
            radarr.getQualityProfiles(),
            radarr.getRootFolders()
        ]);

        if (profiles.length === 0 || folders.length === 0) {
            throw new Error("Cannot add movie: missing quality profiles or root folders in Radarr.");
        }

        // Use the first available profile and folder as defaults
        const qualityProfileId = profiles[0]?.id;
        const rootFolderPath = folders[0]?.path;

        if (!qualityProfileId || !rootFolderPath) {
            return { message: "Error: Could not retrieve base Radarr quality profile or root folder configuration." } as any;
        }

        const result = await radarr.addMovie(tmdbId, title, year, rootFolderPath, qualityProfileId);
        return {
            success: true,
            message: `Successfully added '${result.title}' to Radarr.`
        };
    },
});

export const getMovieQueueTool = tool({
    description: "Get the current queue of movies downloading in Radarr.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        const queue = await radarr.getMovieQueue();
        if (queue.length === 0) {
            return { message: "The Radarr download queue is currently empty." };
        }
        return queue.map(q => ({
            title: q.title,
            sizeTotal: q.size,
            sizeLeft: q.sizeleft,
        })) as any;
    },
});

// --- Sonarr Tools --- //

export const searchSeriesTool = tool({
    description: "Search for a TV series in Sonarr to get its TVDB ID.",
    parameters: z.object({
        term: z.string().describe("The name of the TV show to search for."),
    }),
    execute: async ({ term }: any) => {
        const results = await sonarr.searchSeries(term);
        return results.slice(0, 5).map(s => ({
            title: s.title,
            year: s.year,
            tvdbId: s.tvdbId,
            network: s.network,
            monitored: s.monitored,
        })) as any;
    },
});

export const addSeriesTool = tool({
    description: "Add a TV series to Sonarr to begin downloading it. Requires the TVDB ID.",
    parameters: z.object({
        tvdbId: z.number().describe("The TVDB ID of the series."),
        title: z.string().describe("The title of the series."),
    }),
    execute: async ({ tvdbId, title }: { tvdbId: number, title: string }) => {
        const [profiles, languageProfiles, folders, seriesDetails] = await Promise.all([
            sonarr.getQualityProfiles(),
            sonarr.getLanguageProfiles(),
            sonarr.getRootFolders(),
            sonarr.searchSeries(title)
        ]);

        if (profiles.length === 0 || languageProfiles.length === 0 || folders.length === 0) {
            throw new Error("Cannot add series: missing profiles or root folders in Sonarr.");
        }

        const exactSeries = seriesDetails.find(s => s.tvdbId === tvdbId);
        if (!exactSeries) {
            throw new Error("Could not fetch full details for series to add.");
        }

        // Use the first available profile and folder as defaults
        const qualityProfileId = profiles[0]?.id;
        const languageProfileId = languageProfiles[0]?.id;
        const rootFolderPath = folders[0]?.path;

        if (!qualityProfileId || !languageProfileId || !rootFolderPath) {
            return { message: "Error: Could not retrieve base Sonarr configuration (profile, language, or root settings)." } as any;
        }

        // Monitor all seasons by default
        const seasons = exactSeries.seasons?.map(s => ({ seasonNumber: s.seasonNumber, monitored: true })) || [];

        const result = await sonarr.addSeries(tvdbId, title, qualityProfileId, languageProfileId, rootFolderPath, seasons);
        return {
            success: true,
        };
    },
});

export const getSeriesQueueTool = tool({
    description: "Get the current queue of TV shows downloading in Sonarr.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        const queue = await sonarr.getSeriesQueue();
        if (queue.length === 0) {
            return { message: "The Sonarr download queue is currently empty." };
        }
        return queue.map(q => ({
            title: q.title,
            sizeTotal: q.size,
            sizeLeft: q.sizeleft,
        })) as any;
    },
});

// --- qBittorrent Tools --- //

export const getTorrentsTool = tool({
    description: "Get a list of active torrents downloading or seeding in qBittorrent.",
    parameters: z.object({
        filter: z.enum(["all", "downloading", "seeding", "paused", "active"]).optional().describe("Filter for the list of torrents."),
    }),
    execute: async ({ filter = "downloading" }: { filter?: string }) => {
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
    },
});

export const pauseTorrentTool = tool({
    description: "Pause a specific torrent by its hash.",
    parameters: z.object({
        hash: z.string().describe("The hash of the torrent to pause."),
    }),
    execute: async ({ hash }: { hash: string }) => {
        await qbittorrent.pauseTorrent(hash);
        return { message: `Successfully paused torrent with hash ${hash}` };
    },
});

export const resumeTorrentTool = tool({
    description: "Resume a specific torrent by its hash.",
    parameters: z.object({
        hash: z.string().describe("The hash of the torrent to resume."),
    }),
    execute: async ({ hash }: { hash: string }) => {
        await qbittorrent.resumeTorrent(hash);
        return { message: `Successfully resumed torrent with hash ${hash}` };
    },
});

// --- Plex Tools --- //

export const searchPlexLibraryTool = tool({
    description: "Search the local Plex library to see if a movie or show already exists by title.",
    parameters: z.object({
        query: z.string().describe("The name of the movie or show to search for in Plex."),
    }),
    execute: async ({ query }: { query: string }) => {
        const result = await plex.searchPlex(query);
        if (!result.Metadata || result.Metadata.length === 0) {
            return { message: `No results found in Plex library for '${query}'.` };
        }
        return result.Metadata.slice(0, 5).map(m => ({
            title: m.title,
            type: m.type,
            year: m.year,
        })) as any;
    },
});

export const browsePlexByGenreTool = tool({
    description: "Find movies or shows in the Plex library that match a specific genre (e.g., Horror, Comedy).",
    parameters: z.object({
        genre: z.string().describe("The genre to browse for."),
    }),
    execute: async ({ genre }: { genre: string }) => {
        let sectionIds = plex.getMovieSectionIds();

        // If no sections are explicitly mapped, find all 'movie' sections automatically
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
                const result = await plex.getItemsByGenre(sectionId, genre);
                if (result.Metadata) {
                    allResults.push(...result.Metadata);
                }
            } catch (error) {
                console.error(`Error browsing section ${sectionId} for genre ${genre}:`, error);
            }
        }

        if (allResults.length === 0) {
            return { message: `No items found in your Plex library for genre '${genre}' across checked sections (${sectionIds.join(", ")}).` };
        }

        return {
            totalFound: allResults.length,
            sampleItems: allResults.slice(0, 15).map(m => ({
                title: m.title,
                year: m.year,
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
    description: "Check if a specific service (Radarr, Sonarr, qBittorrent, or Plex) is online and responsive.",
    parameters: z.object({
        service: z.enum(["Radarr", "Sonarr", "qBittorrent", "Plex"]).describe("The service to check health for."),
    }),
    execute: async ({ service }: { service: string }) => {
        try {
            if (service === "Radarr") await radarr.getSystemStatus();
            if (service === "Sonarr") await sonarr.getSystemStatus();
            if (service === "Plex") await plex.getSystemStatus();
            if (service === "qBittorrent") await qbittorrent.getTorrents("all");
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
        return missing.slice(0, 10).map(m => ({ title: m.title, year: m.year }));
    },
});

export const getMissingSeriesTool = tool({
    description: "Get a list of TV shows in Sonarr that are missing episodes.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        const missing = await sonarr.getMissingSeries();
        if (missing.length === 0) return { message: "No series with missing episodes found in Sonarr." };
        return missing.slice(0, 10).map(s => ({ title: s.title, percentDone: s.statistics?.percentOfEpisodes + "%" }));
    },
});
