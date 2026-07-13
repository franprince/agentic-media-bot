import { tool } from "ai";
import { z } from "zod";
import * as db from "../../services/database";
import * as plex from "../../services/plex";
import * as radarr from "../../services/radarr";
import { withCache } from "./cache";
import {
	formatBytes,
	formatEstimatedCompletion,
	stripDiacritics,
} from "./formatters";

// Helper to find default quality profile matching "Full-HD or Better"
export function getDefaultQualityProfile(
	profiles: Array<{ id: number; name: string }>,
): { id: number; name: string } | undefined {
	if (!profiles || profiles.length === 0) return undefined;

	// Always prioritize "Full-HD or Better (NO REMUX)" (case-insensitively, with normalization)
	const exactMatch = profiles.find((p) => {
		const name = p.name.toLowerCase();
		return (
			name.includes("full-hd or better (no remux)") ||
			name.replace(/[^a-z0-9]/g, "").includes("fullhdorbetternoremux")
		);
	});
	if (exactMatch) return exactMatch;

	const preferred =
		profiles.find((p) => {
			const name = p.name.toLowerCase();
			return (
				name.includes("full-hd") ||
				name.includes("full hd") ||
				name.includes("fullhd")
			);
		}) || profiles.find((p) => p.name.toLowerCase().includes("1080p"));
	return preferred || profiles[0];
}

export const searchMovieTool = tool({
	description:
		"Search for a movie in Radarr to get its details, like TMDB ID, year, and if it's already downloaded. USE THIS ONLY ONLY when searching for a SPECIFIC MOVIE TITLE. Do NOT use this for 'Japanese movies', genres like 'Horror', or country-based queries.",
	parameters: z.object({
		term: z
			.string()
			.describe(
				"The name of the movie to search for (e.g., 'Deadpool'). Do NOT include country names or genres here.",
			),
	}),
	execute: async ({ term }: { term: string }) => {
		const normalizedTerm = term?.trim();
		if (!normalizedTerm) {
			return {
				message: "Please provide a movie title to search in Radarr.",
			} as any;
		}

		try {
			const results = await radarr.searchMovie(normalizedTerm);
			const plexResults = await plex
				.searchPlex(normalizedTerm)
				.catch(() => ({ Metadata: [] }));
			const plexMetadata = plexResults?.Metadata || [];

			// Limit results to avoid massive context payloads
			return results.slice(0, 5).map((m) => {
				const alreadyInPlex = plexMetadata.some((pm: any) => {
					const imdbMatch = pm.guid?.match(/imdb:\/\/(tt\d+)/);
					const tmdbMatch = pm.guid?.match(/tmdb:\/\/(\d+)/);
					const pmImdbId = imdbMatch ? imdbMatch[1] : undefined;
					const pmTmdbId = tmdbMatch ? tmdbMatch[1] : undefined;

					if (m.imdbId && pmImdbId && m.imdbId === pmImdbId) return true;
					if (m.tmdbId && pmTmdbId && String(m.tmdbId) === pmTmdbId)
						return true;

					const titleMatch =
						pm.title?.toLowerCase() === m.title?.toLowerCase() ||
						pm.title?.toLowerCase() === m.originalTitle?.toLowerCase();
					const yearMatch =
						pm.year && m.year && Math.abs(pm.year - m.year) <= 1;
					return titleMatch && yearMatch;
				});

				return {
					title: m.title,
					mediaType: "[Movie]",
					originalTitle: m.originalTitle,
					year: m.year,
					genres: m.genres,
					tmdbId: m.tmdbId,
					imdbId: m.imdbId,
					overview: m.overview,
					posterUrl:
						m.images?.find((i) => i.coverType === "poster")?.remoteUrl ||
						m.images?.find((i) => i.coverType === "poster")?.url,
					hasFile: m.hasFile,
					monitored: m.monitored,
					ratings: m.ratings,
					alreadyInPlex,
				};
			}) as any;
		} catch (_error: any) {
			return {
				message:
					"I couldn't query Radarr right now. Please try again in a moment.",
			} as any;
		}
	},
});

export const addMovieTool = tool({
	description:
		"Add a MOVIE to Radarr to begin downloading it. Requires the TMDB ID from a previous search. Do NOT use this for TV shows/series. This tool will first return details and available configuration options (quality profiles, folders) for confirmation unless 'confirm' is true.",
	parameters: z.object({
		tmdbId: z
			.union([z.number(), z.string().transform(Number)])
			.nullable()
			.describe("The TMDB ID of the movie to add."),
		title: z.string().describe("The title of the movie."),
		year: z
			.union([z.number(), z.string().transform(Number)])
			.nullable()
			.describe("The release year of the movie."),
		imdbId: z
			.string()
			.optional()
			.describe("The IMDb ID of the movie (e.g., 'tt0111161')."),
		qualityProfileId: z
			.number()
			.optional()
			.describe("The ID of the quality profile to use (e.g., 1 for HD-1080p)."),
		rootFolderPath: z
			.string()
			.optional()
			.describe("The root folder path where the movie should be saved."),
		confirm: z
			.boolean()
			.default(false)
			.describe(
				"Set to true ONLY when the user has explicitly confirmed the specific match and settings (folder, profile).",
			),
		tags: z
			.array(z.string())
			.optional()
			.describe(
				"Custom tag labels to apply to the movie in Radarr (e.g. ['4k-only']).",
			),
	}),
	execute: async ({
		tmdbId,
		title,
		year,
		imdbId,
		qualityProfileId,
		rootFolderPath,
		confirm,
		tags,
	}: {
		tmdbId: number | null;
		title: string;
		year: number | null;
		imdbId?: string;
		qualityProfileId?: number;
		rootFolderPath?: string;
		confirm: boolean;
		tags?: string[];
	}) => {
		let normalizedTmdbId =
			tmdbId !== null && tmdbId !== undefined ? Number(tmdbId) : 0;
		let normalizedYear = year !== null && year !== undefined ? Number(year) : 0;

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
				console.warn(
					`⚠️ IMDb search failed for ${imdbId}:`,
					(err as Error).message,
				);
			}
		}

		if (normalizedTmdbId <= 0 || normalizedYear <= 0) {
			try {
				const results = await radarr.searchMovie(title);
				return {
					message:
						"Missing TMDB ID or year. Please choose the correct match first.",
					suggestions: results.slice(0, 5).map((m) => ({
						title: m.title,
						originalTitle: m.originalTitle,
						year: m.year,
						genres: m.genres,
						tmdbId: m.tmdbId,
						imdbId: m.imdbId,
						overview: m.overview,
						posterUrl:
							m.images?.find((i) => i.coverType === "poster")?.remoteUrl ||
							m.images?.find((i) => i.coverType === "poster")?.url,
					})),
				} as any;
			} catch (error: any) {
				return {
					message:
						"I couldn't search Radarr for that title due to a service error. Please try again in a moment, or ask me to search Plex instead.",
				} as any;
			}
		}

		try {
			// Fetch required configuration dynamically
			const [profiles, folders] = await Promise.all([
				withCache("radarr_profiles", () => radarr.getQualityProfiles()),
				withCache("radarr_folders", () => radarr.getRootFolders()),
			]);

			if (profiles.length === 0 || folders.length === 0) {
				return {
					message:
						"Cannot add movie right now: Radarr quality profiles or root folders are unavailable.",
				} as any;
			}

			// Find match details for confirmation or adding
			const results = await radarr.searchMovie(title);
			const match =
				results.find(
					(m) => m.tmdbId === normalizedTmdbId && m.year === normalizedYear,
				) || results[0];

			if (!match) {
				return {
					message: `Could not find movie details for "${title}" (${normalizedYear}) to proceed.`,
				} as any;
			}

			const titleMismatch =
				imdbMatch &&
				stripDiacritics(match.title.toLowerCase()) !==
					stripDiacritics(title.toLowerCase());

			const defaultProfile = getDefaultQualityProfile(profiles);

			if (!confirm || titleMismatch) {
				let statusMessage = `I found "${match.title}" (${match.year}). Please confirm if I should add it and which settings to use:`;
				if (titleMismatch) {
					statusMessage = `⚠️ *Title Mismatch:* I found "${match.title}" (${match.year}) for the IMDb ID \`${imdbId}\`, but you mentioned "${title}". Should I proceed with "${match.title}" using these settings?`;
				}

				return {
					confirmationRequired: true,
					message: statusMessage,
					availableProfiles: profiles.map((p) => ({ id: p.id, name: p.name })),
					availableFolders: folders.map((f) => ({
						path: f.path,
						freeSpace: (f.freeSpace / 1024 / 1024 / 1024).toFixed(1) + " GB",
					})),
					mediaDetails: {
						title: match.title,
						year: match.year,
						overview: match.overview,
						posterUrl:
							match.images?.find((i) => i.coverType === "poster")?.remoteUrl ||
							match.images?.find((i) => i.coverType === "poster")?.url,
						tmdbId: match.tmdbId,
					},
					buttons: [
						{
							text: "✅ Yes, Add Movie",
							data: `add movie ${match.tmdbId} ${defaultProfile?.id}`,
						},
						{ text: "❌ Cancel", data: "cancel add movie" },
					],
				} as any;
			}

			// Final addition using specified or default settings
			const finalProfileId = qualityProfileId ?? defaultProfile?.id;
			const finalFolderPath = rootFolderPath ?? folders[0]?.path;

			if (finalProfileId === undefined || finalFolderPath === undefined) {
				return {
					message:
						"Error: Could not determine quality profile or root folder for Radarr addition.",
				} as any;
			}

			let resolvedTagIds: number[] | undefined;
			if (tags && tags.length > 0) {
				resolvedTagIds = await radarr.resolveTagIds(tags);
			}

			const result = await radarr.addMovie(
				normalizedTmdbId,
				match.title,
				match.year,
				finalFolderPath,
				finalProfileId,
				resolvedTagIds,
			);
			return {
				success: true,
				message: `Successfully added '${result.title}' to Radarr.`,
				tmdbId: normalizedTmdbId,
				title: result.title,
			};
		} catch (_error: any) {
			return {
				message:
					"Radarr rejected that add request. Please check if the movie is already in your library.",
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
			const tz = db.getTimezone();
			return queue.map((q: any) => {
				const size = q.size || 0;
				const sizeLeft = q.sizeleft || 0;
				const downloaded = Math.max(0, size - sizeLeft);
				const progress =
					size > 0 ? ((downloaded / size) * 100).toFixed(2) + "%" : "0.00%";
				return {
					title: q.title,
					status: q.status,
					progress,
					downloaded: formatBytes(downloaded),
					sizeTotal: formatBytes(size),
					sizeLeft: formatBytes(sizeLeft),
					eta: formatEstimatedCompletion(
						q.estimatedCompletionTime || q.timeleft,
						tz,
					),
				};
			}) as any;
		} catch (error: any) {
			return {
				message: `Failed to fetch Radarr queue: ${error.message || "Unknown error"}`,
			};
		}
	},
});

export const removeMovieTool = tool({
	description:
		"Remove a MOVIE from Radarr. Requires the TMDB ID from a previous search. This tool will first return the match details and ask for confirmation along with a choice to delete or keep the actual media files, unless 'confirm' is true.",
	parameters: z.object({
		tmdbId: z
			.union([z.number(), z.string().transform(Number)])
			.describe("The TMDB ID of the movie to remove."),
		deleteFiles: z
			.boolean()
			.default(false)
			.describe("Whether to delete the downloaded media files as well."),
		confirm: z
			.boolean()
			.default(false)
			.describe(
				"Set to true ONLY when the user has explicitly confirmed the removal and the file deletion choice.",
			),
	}),
	execute: async ({
		tmdbId,
		deleteFiles,
		confirm,
	}: {
		tmdbId: number;
		deleteFiles: boolean;
		confirm: boolean;
	}) => {
		try {
			const results = await radarr.searchMovie(`tmdb:${tmdbId}`);
			const match = results.find((m) => m.tmdbId === Number(tmdbId));
			if (!match || !match.id) {
				return {
					message: `Could not find a movie in Radarr with TMDB ID ${tmdbId}.`,
				};
			}

			if (!confirm) {
				return {
					message: `Found movie: '${match.title} (${match.year})'. Path: ${match.path || "N/A"}.\n\n⚠️ Are you sure you want to remove it? Please confirm and specify if you want to **DELETE THE MEDIA FILES** or keep them safely.`,
					item: {
						title: match.title,
						year: match.year,
						tmdbId: match.tmdbId,
						path: match.path,
					},
					requiresConfirmation: true,
					buttons: [
						{
							text: "✅ Remove from Radarr only",
							data: "Remove the movie but keep the files",
						},
						{
							text: "🗑️ Remove and DELETE files",
							data: "Remove the movie and delete the files",
						},
					],
				};
			}

			await radarr.deleteMovie(match.id, deleteFiles);
			return {
				success: true,
				message: `Successfully removed '${match.title}' from Radarr. Files deleted: ${deleteFiles}.`,
			};
		} catch (error: any) {
			return {
				message: `Failed to remove movie: ${error.message || "Unknown error"}`,
			};
		}
	},
});

export const getMissingMoviesTool = tool({
	description:
		"Get a list of movies that are monitored in Radarr but are missing from the disk.",
	parameters: z.object({}),
	execute: async (_args: any) => {
		const missing = await radarr.getMissingMovies();
		if (missing.length === 0)
			return { message: "No missing movies found in Radarr." };
		return {
			totalMissing: missing.length,
			sample: missing
				.slice(0, 10)
				.map((m) => ({ title: m.title, year: m.year })),
		};
	},
});
