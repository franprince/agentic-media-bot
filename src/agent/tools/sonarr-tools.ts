import { tool } from "ai";
import { z } from "zod";
import * as db from "../../services/database";
import {
	findInLibrary,
	loadLibrary,
	normalizeTitle,
} from "../../services/library";
import * as sonarr from "../../services/sonarr";
import { withCache } from "./cache";
import {
	formatBytes,
	formatEstimatedCompletion,
	stripDiacritics,
} from "./formatters";
import { getDefaultQualityProfile } from "./radarr-tools";

// Helper to find default language profile matching "Original" or "Original Language"
function getDefaultLanguageProfile(
	languages: Array<{ id: number; name: string }>,
): { id: number; name: string } | undefined {
	if (!languages || languages.length === 0) return undefined;
	const preferred = languages.find((l) => {
		const name = l.name.toLowerCase();
		return name.includes("original");
	});
	return preferred || languages[0];
}

export const searchSeriesTool = tool({
	description:
		"Search for a TV series in Sonarr to get its TVDB ID. USE THIS ONLY ONLY when searching for a SPECIFIC SERIES TITLE. Do NOT use this for queries like 'Japanese series', 'Spanish shows', or genre-based queries.",
	parameters: z.object({
		term: z
			.string()
			.describe(
				"The name of the TV show to search for (e.g., 'The Boys'). Do NOT include country names or genres here.",
			),
	}),
	execute: async ({ term }: any) => {
		const [results, library] = await Promise.all([
			sonarr.searchSeries(term),
			loadLibrary(),
		]);

		return results.slice(0, 5).map((s) => {
			const match = findInLibrary(library, {
				kind: "show",
				tvdbId: s.tvdbId,
				tmdbId: s.tmdbId,
				imdbId: s.imdbId,
				title: s.title,
				originalTitle: s.originalTitle,
				year: s.year,
			});
			const statistics = match.series?.statistics;
			const plexTitle = match.plex?.title;

			return {
				title: s.title,
				mediaType: "[Show]",
				originalTitle: s.originalTitle,
				year: s.year,
				genres: s.genres,
				tvdbId: s.tvdbId,
				imdbId: s.imdbId,
				overview: s.overview,
				posterUrl:
					s.images?.find((i) => i.coverType === "poster")?.remoteUrl ||
					s.images?.find((i) => i.coverType === "poster")?.url,
				network: s.network,
				monitored: s.monitored,
				ratings: s.ratings,
				alreadyInSonarr: Boolean(match.series) || (s.id ?? 0) > 0,
				...(statistics
					? {
							episodesDownloaded: `${statistics.episodeFileCount} of ${statistics.episodeCount}`,
						}
					: {}),
				alreadyInPlex: match.inPlex,
				...(plexTitle && normalizeTitle(plexTitle) !== normalizeTitle(s.title)
					? { plexTitle }
					: {}),
			};
		}) as any;
	},
});

export const addSeriesTool = tool({
	description:
		"Add a TV SERIES/SHOW to Sonarr to begin downloading it. Requires the TVDB ID from a previous search. Do NOT use this for movies. This tool will first return details and available configuration options (profiles, folders) for confirmation unless 'confirm' is true.",
	parameters: z.object({
		tvdbId: z
			.union([z.number(), z.string().transform(Number)])
			.nullable()
			.describe("The TVDB ID of the series."),
		title: z.string().describe("The title of the series."),
		imdbId: z
			.string()
			.optional()
			.describe("The IMDb ID of the series (e.g., 'tt0111161')."),
		qualityProfileId: z
			.number()
			.optional()
			.describe("The ID of the quality profile to use."),
		languageProfileId: z
			.number()
			.optional()
			.describe("The ID of the language profile to use."),
		rootFolderPath: z
			.string()
			.optional()
			.describe("The root folder path for the series."),
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
				"Custom tag labels to apply to the series in Sonarr (e.g. ['anime']).",
			),
	}),
	execute: async ({
		tvdbId,
		title,
		imdbId,
		qualityProfileId,
		languageProfileId,
		rootFolderPath,
		confirm,
		tags,
	}: {
		tvdbId: number | null;
		title: string;
		imdbId?: string;
		qualityProfileId?: number;
		languageProfileId?: number;
		rootFolderPath?: string;
		confirm: boolean;
		tags?: string[];
	}) => {
		let normalizedTvdbId =
			tvdbId !== null && tvdbId !== undefined ? Number(tvdbId) : 0;

		let imdbMatch: any = null;
		if (imdbId) {
			try {
				const results = await sonarr.searchSeries(imdbId);
				imdbMatch = results[0];
				if (imdbMatch) {
					normalizedTvdbId = imdbMatch.tvdbId;
				}
			} catch (err) {
				console.warn(
					`⚠️ IMDb search failed for ${imdbId}:`,
					(err as Error).message,
				);
			}
		}

		if (normalizedTvdbId <= 0) {
			const results = await sonarr.searchSeries(title);
			return {
				message: "Missing TVDB ID. Please choose the correct series first.",
				suggestions: results.slice(0, 5).map((s) => ({
					title: s.title,
					originalTitle: s.originalTitle,
					year: s.year,
					genres: s.genres,
					tvdbId: s.tvdbId,
					imdbId: s.imdbId,
					overview: s.overview,
					posterUrl:
						s.images?.find((i) => i.coverType === "poster")?.remoteUrl ||
						s.images?.find((i) => i.coverType === "poster")?.url,
				})),
			} as any;
		}

		const [profiles, languageProfiles, folders] = await Promise.all([
			withCache("sonarr_profiles", () => sonarr.getQualityProfiles()),
			withCache("sonarr_languages", () => sonarr.getLanguageProfiles()),
			withCache("sonarr_folders", () => sonarr.getRootFolders()),
		]);

		if (
			profiles.length === 0 ||
			languageProfiles.length === 0 ||
			folders.length === 0
		) {
			return {
				message:
					"Cannot add series: missing profiles or root folders in Sonarr.",
			} as any;
		}

		// Try to get exact series details using TVDB ID directly
		let exactSeries = await sonarr.getSeriesByTvdbId(normalizedTvdbId);

		// Fallback to title search if ID lookup fails
		if (!exactSeries) {
			const seriesDetails = await sonarr.searchSeries(title);
			exactSeries = seriesDetails.find((s) => s.tvdbId === normalizedTvdbId);
		}

		if (!exactSeries) {
			return {
				message: `Could not fetch details for series "${title}" (TVDB ID: ${normalizedTvdbId}). Please try searching for the series by name again to refresh the IDs.`,
			} as any;
		}

		const titleMismatch =
			imdbMatch &&
			stripDiacritics(exactSeries.title.toLowerCase()) !==
				stripDiacritics(title.toLowerCase());

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
				availableProfiles: profiles.map((p) => ({ id: p.id, name: p.name })),
				availableLanguages: languageProfiles.map((l) => ({
					id: l.id,
					name: l.name,
				})),
				availableFolders: folders.map((f) => ({
					path: f.path,
					freeSpace: (f.freeSpace / 1024 / 1024 / 1024).toFixed(1) + " GB",
				})),
				mediaDetails: {
					title: exactSeries.title,
					year: exactSeries.year,
					overview: exactSeries.overview,
					posterUrl:
						exactSeries.images?.find((i) => i.coverType === "poster")
							?.remoteUrl ||
						exactSeries.images?.find((i) => i.coverType === "poster")?.url,
					tvdbId: exactSeries.tvdbId,
					network: exactSeries.network,
					seasons: exactSeries.seasons?.length || 0,
					genres: exactSeries.genres,
				},
				buttons: [
					{
						// The default profile is what this button uses; say so.
							text: defaultProfile?.name
								? `✅ Yes, Add Series (${defaultProfile.name})`
								: "✅ Yes, Add Series",
						data: `add series ${exactSeries.tvdbId} ${defaultProfile?.id}`,
					},
					{ text: "❌ Cancel", data: "cancel add series" },
				],
			} as any;
		}

		// Use specified or default settings
		const finalProfileId = qualityProfileId ?? defaultProfile?.id;
		const finalLanguageId = languageProfileId ?? defaultLanguage?.id;
		const finalFolderPath = rootFolderPath ?? folders[0]?.path;

		if (!finalProfileId || !finalLanguageId || !finalFolderPath) {
			return {
				message:
					"Error: Could not retrieve base Sonarr configuration (profile, language, or root settings).",
			} as any;
		}

		// Monitor all seasons by default
		const seasons =
			exactSeries.seasons?.map((s) => ({
				seasonNumber: s.seasonNumber,
				monitored: true,
			})) || [];

		// Anime Detection
		const isAnime =
			exactSeries.genres?.some((g) => g.toLowerCase() === "anime") ||
			(exactSeries.genres?.some((g) => g.toLowerCase() === "animation") &&
				exactSeries.genres?.some((g) =>
					["action", "adventure", "fantasy"].includes(g.toLowerCase()),
				));

		const seriesType = isAnime ? "anime" : "standard";

		let resolvedTagIds: number[] | undefined;
		if (tags && tags.length > 0) {
			resolvedTagIds = await sonarr.resolveTagIds(tags);
		}

		await sonarr.addSeries(
			normalizedTvdbId,
			exactSeries.title,
			finalProfileId,
			finalLanguageId,
			finalFolderPath,
			seasons,
			seriesType,
			resolvedTagIds,
		);

		return {
			success: true,
			message: `Successfully added '${exactSeries.title}' to Sonarr as ${seriesType} series.`,
			tvdbId: normalizedTvdbId,
			title: exactSeries.title,
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
				message: `Failed to fetch Sonarr queue: ${error.message || "Unknown error"}`,
			};
		}
	},
});

export const removeSeriesTool = tool({
	description:
		"Remove a TV SERIES from Sonarr. Requires the TVDB ID from a previous search. This tool will first return the match details and ask for confirmation along with a choice to delete or keep the actual media files, unless 'confirm' is true.",
	parameters: z.object({
		tvdbId: z
			.union([z.number(), z.string().transform(Number)])
			.describe("The TVDB ID of the series to remove."),
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
		tvdbId,
		deleteFiles,
		confirm,
	}: {
		tvdbId: number;
		deleteFiles: boolean;
		confirm: boolean;
	}) => {
		try {
			const match = await sonarr.getSeriesByTvdbId(Number(tvdbId));
			if (!match || !match.id) {
				return {
					message: `Could not find a series in Sonarr with TVDB ID ${tvdbId}.`,
				};
			}

			if (!confirm) {
				return {
					message: `Found series: '${match.title} (${match.year})'. Path: ${match.path || "N/A"}.\n\n⚠️ Are you sure you want to remove it? Please confirm and specify if you want to **DELETE THE MEDIA FILES** or keep them safely.`,
					item: {
						title: match.title,
						year: match.year,
						tvdbId: match.tvdbId,
						path: match.path,
					},
					requiresConfirmation: true,
					buttons: [
						{
							text: "✅ Remove from Sonarr only",
							data: "Remove the series but keep the files",
						},
						{
							text: "🗑️ Remove and DELETE files",
							data: "Remove the series and delete the files",
						},
					],
				};
			}

			await sonarr.deleteSeries(match.id, deleteFiles);
			return {
				success: true,
				message: `Successfully removed '${match.title}' from Sonarr. Files deleted: ${deleteFiles}.`,
			};
		} catch (error: any) {
			return {
				message: `Failed to remove series: ${error.message || "Unknown error"}`,
			};
		}
	},
});

export const getMissingSeriesTool = tool({
	description: "Get a list of TV shows in Sonarr that are missing episodes.",
	parameters: z.object({}),
	execute: async (_args: any) => {
		const missing = await sonarr.getMissingSeries();
		if (missing.length === 0)
			return { message: "No series with missing episodes found in Sonarr." };
		return {
			totalMissingSeries: missing.length,
			sample: missing.slice(0, 10).map((s) => ({
				title: s.title,
				percentDone: (s.statistics?.percentOfEpisodes ?? 0).toFixed(1) + "%",
			})),
		};
	},
});

export const getMissingEpisodesTool = tool({
	description:
		"Get a detailed list of specific missing TV episodes in Sonarr, including season, episode number, and release date.",
	parameters: z.object({}),
	execute: async (_args: any) => {
		const result = await sonarr.getMissingEpisodes();
		if (result.totalRecords === 0)
			return { message: "No missing episodes found in Sonarr." };
		return {
			totalMissingEpisodes: result.totalRecords,
			sample: result.records.slice(0, 15).map((e: any) => ({
				seriesTitle: e.series?.title,
				season: e.seasonNumber,
				episode: e.episodeNumber,
				airDate: e.airDate,
			})),
		};
	},
});
