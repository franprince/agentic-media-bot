import { tool } from "ai";
import { z } from "zod";
import * as db from "../../services/database";
import * as plex from "../../services/plex";

export const getWatchlistTool = tool({
	description:
		"Get the user's unified watchlist (combining local SQLite watchlist and Plex watchlist). Shows titles, media types, and status ('pending', 'downloading', 'completed').",
	parameters: z.object({}),
	execute: async () => {
		try {
			// First, trigger a quick background sync to ensure local DB matches Plex Watchlist
			await plex.syncWatchlist();

			const list = db.getLocalWatchlist();
			if (list.length === 0) {
				return { message: "Your watchlist is currently empty." };
			}
			return {
				watchlist: list.map((item) => ({
					title: item.title,
					mediaType: item.media_type,
					ratingKey: item.rating_key || undefined,
					imdbId: item.imdb_id || undefined,
					tmdbId: item.tmdb_id || undefined,
					tvdbId: item.tvdb_id || undefined,
					status: item.status,
					addedAt: item.added_at,
				})),
			};
		} catch (error: any) {
			return {
				message: `Failed to retrieve watchlist: ${error.message || "Unknown error"}`,
			};
		}
	},
});

export const addToWatchlistTool = tool({
	description:
		"Add a movie or TV show to the watchlist. Will search Plex Discover to find the title, add it to the online Plex Watchlist, and sync it locally.",
	parameters: z.object({
		title: z
			.string()
			.describe("The title of the movie or show to add to the watchlist."),
		mediaType: z
			.enum(["movie", "show"])
			.describe("The media type: 'movie' or 'show'."),
	}),
	execute: async ({
		title,
		mediaType,
	}: {
		title: string;
		mediaType: "movie" | "show";
	}) => {
		try {
			// Search Plex Discover to get the best match
			const results = await plex.searchPlexDiscover(title, 5);
			const targetType = mediaType === "movie" ? "movie" : "show";
			const match = results.find((r) => r.type === targetType);

			if (match) {
				// Add to Plex online watchlist
				const addedToPlex = await plex.addToPlexWatchlist(match.ratingKey);
				if (!addedToPlex) {
					return {
						message: `Found matching item "${match.title}" (${match.year}) on Plex Discover, but failed to add it to your Plex Watchlist.`,
					};
				}

				// Resolve detailed metadata to get external IDs (IMDb, TMDB, TVDB)
				let imdb: string | null = null;
				let tmdb: number | null = null;
				let tvdb: number | null = null;
				try {
					const meta = await plex.getPlexDiscoverMetadata(match.ratingKey);
					const imdbId = meta?.Guid?.find((g: any) =>
						g.id.startsWith("imdb://"),
					)?.id?.replace("imdb://", "");
					const tmdbId = meta?.Guid?.find((g: any) =>
						g.id.startsWith("tmdb://"),
					)?.id?.replace("tmdb://", "");
					const tvdbId = meta?.Guid?.find((g: any) =>
						g.id.startsWith("tvdb://"),
					)?.id?.replace("tvdb://", "");
					if (imdbId) imdb = imdbId;
					if (tmdbId) tmdb = parseInt(tmdbId);
					if (tvdbId) tvdb = parseInt(tvdbId);
				} catch (metaErr) {
					console.error(
						"Failed to retrieve detailed metadata for watchlist item:",
						metaErr,
					);
				}

				// Add to local database
				db.addToLocalWatchlist({
					title: match.title,
					media_type: targetType,
					rating_key: match.ratingKey,
					imdb_id: imdb,
					tmdb_id: tmdb,
					tvdb_id: tvdb,
					status: "pending",
				});

				return {
					success: true,
					message: `✅ Added "${match.title}" (${match.year}) to your watchlist (synced with Plex).`,
				};
			} else {
				// Fallback: If not found on Plex Discover, still add locally to SQLite!
				db.addToLocalWatchlist({
					title,
					media_type: targetType,
					status: "pending",
				});
				return {
					success: true,
					message: `✅ Added "${title}" to your local watchlist database (could not find matching item on Plex Discover).`,
				};
			}
		} catch (error: any) {
			return {
				message: `Failed to add to watchlist: ${error.message || "Unknown error"}`,
			};
		}
	},
});

export const removeFromWatchlistTool = tool({
	description:
		"Remove a movie or TV show from the watchlist (removes it from both Plex watchlist and SQLite).",
	parameters: z.object({
		titleOrRatingKey: z
			.string()
			.describe("The title or Plex ratingKey of the item to remove."),
	}),
	execute: async ({ titleOrRatingKey }: { titleOrRatingKey: string }) => {
		try {
			// First check if the item is in our local watchlist database
			const list = db.getLocalWatchlist();
			const found = list.find(
				(item) =>
					item.title.toLowerCase() === titleOrRatingKey.toLowerCase() ||
					item.rating_key === titleOrRatingKey,
			);

			if (found) {
				if (found.rating_key) {
					// Try to remove from Plex online watchlist
					await plex.removeFromPlexWatchlist(found.rating_key);
				}

				// Remove from local database
				db.removeFromLocalWatchlist(titleOrRatingKey);
				return {
					success: true,
					message: `✅ Removed "${found.title}" from your watchlist.`,
				};
			}

			// If not found locally, still attempt removal in case of string ratingKey
			db.removeFromLocalWatchlist(titleOrRatingKey);
			return {
				success: true,
				message: `✅ Attempted removal of "${titleOrRatingKey}" from watchlist.`,
			};
		} catch (error: any) {
			return {
				message: `Failed to remove from watchlist: ${error.message || "Unknown error"}`,
			};
		}
	},
});

export const syncWatchlistTool = tool({
	description:
		"Manually force a synchronization between the local watchlist SQLite database and the Plex watchlist.",
	parameters: z.object({}),
	execute: async () => {
		try {
			const stats = await plex.syncWatchlist();
			return {
				success: true,
				message: `🔄 Watchlist synchronized successfully: added ${stats.added} new item(s) from Plex, removed ${stats.removed} item(s) no longer in Plex.`,
			};
		} catch (error: any) {
			return {
				message: `Failed to sync watchlist: ${error.message || "Unknown error"}`,
			};
		}
	},
});
