import { tool } from "ai";
import { z } from "zod";
import { findInLibrary, loadLibrary } from "../../services/library";
import * as mediaToolsClient from "../../services/media-tools-client";
import { formatBytes } from "./formatters";

export const checkServiceHealthTool = tool({
	description:
		"Check if a specific service (Radarr, Sonarr, qBittorrent, or Plex, or NZBGet) is online and responsive.",
	parameters: z.object({
		service: z
			.string()
			.describe(
				"The service to check health for (e.g., Radarr, Sonarr, qBittorrent, Plex, Jellyfin, NZBGet).",
			),
	}),
	execute: async ({ service }: { service: string }) => {
		try {
			const result = await mediaToolsClient.checkServiceHealth(service);
			return result.online
				? { online: true, message: `${service} is online and responsive.` }
				: {
						online: false,
						message: `${service} appears to be offline or unreachable.`,
					};
		} catch (error: any) {
			if (error?.message?.includes("Unsupported service")) {
				return {
					online: false,
					message: `Service '${service}' is not currently configured or supported for health checks. Supported services are: Radarr, Sonarr, qBittorrent, Plex, and NZBGet.`,
				};
			}
			return {
				online: false,
				message: `${service} appears to be offline or unreachable.`,
			};
		}
	},
});

export const discoverMediaTool = tool({
	description:
		"Discover critically acclaimed or top-rated movies and shows using TMDB. Useful for when the user asks for recommendations. Without a year it covers the last three years.",
	parameters: z.object({
		query: z
			.string()
			.describe(
				"The search query for discovery (e.g., 'comedy series', 'thriller movies', 'korean drama series'). Add a year only if the user names one: a single year limits the results to that year.",
			),
	}),
	execute: async ({ query }: { query: string }) => {
		try {
			const tmdb = await import("../../services/tmdb");
			const results = await tmdb.discoverMedia(query, 15);

			if (results.length === 0) {
				return {
					message: `No TMDB results found for '${query}'.`,
					suggestions: [],
					note: "Try broadening the query (e.g. remove year constraint) or use 'searchMovie'/'searchSeries' directly with a title you know.",
				};
			}

			const library = await loadLibrary();
			const suggestions = results.map((r) => ({
				title: r.title,
				year: r.year,
				type: r.mediaType,
				rating: r.rating,
				voteCount: r.voteCount,
				genres: r.genres,
				overview:
					r.overview.slice(0, 200) + (r.overview.length > 200 ? "…" : ""),
				posterUrl: r.posterPath
					? `https://image.tmdb.org/t/p/w500${r.posterPath}`
					: null,
				warning: r.warning ?? null,
				alreadyInLibrary: findInLibrary(library, {
					kind: r.mediaType === "movie" ? "movie" : "show",
					tmdbId: r.id,
					title: r.title,
					year: r.year,
				}).inLibrary,
			}));
			const unchecked = suggestions.some((s) => s.alreadyInLibrary === null);

			return {
				message: `Found ${results.length} results from TMDB for '${query}'.`,
				suggestions,
				note:
					"Use 'searchMovie' or 'searchSeries' with the exact title to check availability or add to the download queue." +
					(unchecked
						? " 'alreadyInLibrary: null' means the library could not be checked for that title right now: do not say whether the user has it."
						: ""),
			};
		} catch (err: any) {
			console.error("discoverMediaTool TMDB error:", err?.message ?? err);
			return {
				message: `Could not reach TMDB for '${query}'.`,
				suggestions: [],
				note:
					err?.message ??
					"Unknown error. Check TMDB_READ_ACCESS_TOKEN in your environment.",
			};
		}
	},
});

export const getDiskSpaceTool = tool({
	description:
		"Get disk space information for all root folders configured in Radarr and Sonarr.",
	parameters: z.object({}),
	execute: async () => {
		try {
			const entries = await mediaToolsClient.getDiskSpace();

			if (entries.length === 0) {
				return { message: "No root folders configured in Radarr or Sonarr." };
			}

			const results = entries.map((e) => ({
				service: e.service,
				path: e.path,
				freeSpace: formatBytes(e.freeBytes),
				freeBytes: e.freeBytes,
			}));

			return { folders: results };
		} catch (error: any) {
			return {
				message: `Failed to fetch disk space details: ${error.message || "Unknown error"}`,
			};
		}
	},
});
