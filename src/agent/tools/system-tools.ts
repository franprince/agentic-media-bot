import { tool } from "ai";
import { z } from "zod";
import * as plex from "../../services/plex";
import * as radarr from "../../services/radarr";
import * as sonarr from "../../services/sonarr";
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
			if (service === "Radarr") await radarr.getSystemStatus();
			else if (service === "Sonarr") await sonarr.getSystemStatus();
			else if (service === "Plex") await plex.getSystemStatus();
			else if (service === "qBittorrent") {
				const qbittorrent = await import("../../services/qbittorrent");
				await qbittorrent.getTorrents("all");
			} else if (service === "NZBGet") {
				const nzbget = await import("../../services/nzbget");
				await nzbget.getVersion();
			} else {
				return {
					online: false,
					message: `Service '${service}' is not currently configured or supported for health checks. Supported services are: Radarr, Sonarr, qBittorrent, Plex, and NZBGet.`,
				};
			}
			return { online: true, message: `${service} is online and responsive.` };
		} catch (error) {
			return {
				online: false,
				message: `${service} appears to be offline or unreachable.`,
			};
		}
	},
});

export const discoverMediaTool = tool({
	description:
		"Discover critically acclaimed or top-rated movies and shows using TMDB. Useful for when the user asks for recommendations, especially recent releases.",
	parameters: z.object({
		query: z
			.string()
			.describe(
				"The search query for discovery (e.g., 'comedy movies 2025', 'thriller series 2026', 'best drama 2025').",
			),
	}),
	execute: async ({ query }: { query: string }) => {
		try {
			const tmdb = await import("../../services/tmdb");
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
					overview:
						r.overview.slice(0, 200) + (r.overview.length > 200 ? "…" : ""),
					posterUrl: r.posterPath
						? `https://image.tmdb.org/t/p/w500${r.posterPath}`
						: null,
					warning: r.warning ?? null,
				})),
				note: "Use 'searchMovie' or 'searchSeries' with the exact title to check availability or add to the download queue.",
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
			const radarrFolders = await radarr.getRootFolders().catch(() => []);
			const sonarrFolders = await sonarr.getRootFolders().catch(() => []);

			const results: Array<{
				service: string;
				path: string;
				freeSpace: string;
				freeBytes: number;
			}> = [];

			radarrFolders.forEach((f) => {
				results.push({
					service: "Radarr",
					path: f.path,
					freeSpace: formatBytes(f.freeSpace),
					freeBytes: f.freeSpace,
				});
			});

			sonarrFolders.forEach((f) => {
				results.push({
					service: "Sonarr",
					path: f.path,
					freeSpace: formatBytes(f.freeSpace),
					freeBytes: f.freeSpace,
				});
			});

			if (results.length === 0) {
				return { message: "No root folders configured in Radarr or Sonarr." };
			}

			return { folders: results };
		} catch (error: any) {
			return {
				message: `Failed to fetch disk space details: ${error.message || "Unknown error"}`,
			};
		}
	},
});
