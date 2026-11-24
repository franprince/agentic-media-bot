import { tool } from "ai";
import { z } from "zod";
import {
	findInLibrary,
	findPlexCounterpart,
	type LibraryQuery,
	loadLibrary,
	normalizeTitle,
	plexExternalIds,
	searchLibraryTitles,
} from "../../services/library";
import * as plex from "../../services/plex";
import * as radarr from "../../services/radarr";
import * as sonarr from "../../services/sonarr";
import {
	formatDuration,
	hasNonLatinCharacters,
	pickLatinAliasCandidate,
	stripDiacritics,
	uniqueNonEmptyStrings,
} from "./formatters";

// Helper to deduplicate Plex items
export function deduplicatePlexItems(items: any[]): any[] {
	const unique = new Map<string, any>();
	for (const item of items) {
		const dedupeKey =
			item?.ratingKey ||
			item?.guid ||
			`${item?.title ?? "untitled"}::${item?.year ?? ""}`;
		if (!unique.has(dedupeKey)) unique.set(dedupeKey, item);
	}
	return [...unique.values()];
}

export const searchPlexByTitleOnlyTool = tool({
	description:
		"Search the local Plex library to see if a movie or show already exists BY TITLE ONLY. DO NOT use this for genre or country queries.",
	parameters: z.object({
		query: z
			.string()
			.describe("The name of the movie or show to search for in Plex."),
	}),
	execute: async ({ query }: { query: string }) => {
		const normalizedQuery = String(query ?? "").trim();
		if (!normalizedQuery) {
			return {
				message: "Please provide a title to search for in Plex.",
			} as any;
		}

		const attemptQueries = uniqueNonEmptyStrings([
			normalizedQuery,
			stripDiacritics(normalizedQuery),
		]);

		const libraryPromise = loadLibrary();
		const titleSearchHits: any[] = [];
		for (const q of attemptQueries) {
			const result = await plex.searchPlex(q);
			if (result.Metadata && result.Metadata.length > 0) {
				titleSearchHits.push(...result.Metadata);
			}
		}
		const library = await libraryPromise;

		// Plex lists many items under their original-language title, which its
		// title search cannot reach from the name the user knows. The library
		// listings are matched by every name Sonarr and Radarr have for an item.
		const libraryHits = searchLibraryTitles(library, normalizedQuery);

		// Still nothing: the query may be a translated title. Resolve it to ids
		// through Radarr/Sonarr (TMDB/TVDB) and look those ids up in the library.
		let lookupFailed = false;
		if (titleSearchHits.length === 0 && libraryHits.length === 0) {
			const candidates: LibraryQuery[] = [];
			try {
				for (const m of (await radarr.searchMovie(normalizedQuery)).slice(0, 3)) {
					candidates.push({ kind: "movie", ...m });
				}
			} catch {
				lookupFailed = true;
			}
			try {
				for (const s of (await sonarr.searchSeries(normalizedQuery)).slice(0, 3)) {
					candidates.push({ kind: "show", ...s });
				}
			} catch {
				lookupFailed = true;
			}
			for (const candidate of candidates) {
				const match = findInLibrary(library, candidate);
				if (!match.plex && !match.series && !match.movie) continue;
				libraryHits.push({
					kind: candidate.kind,
					knownAs: (match.series ?? match.movie)?.title ?? candidate.title ?? "",
					exact: false,
					plex: match.plex,
					series: match.series,
					movie: match.movie,
				});
			}
		}

		const wanted = normalizeTitle(normalizedQuery);
		const found: Array<{ item: any; knownAs?: string; exact: boolean }> = [
			...libraryHits
				.filter((hit) => hit.plex)
				.map((hit) => ({ item: hit.plex, knownAs: hit.knownAs, exact: hit.exact })),
			...titleSearchHits.map((item) => {
				const kind = item.type === "movie" ? "movie" : item.type === "show" ? "show" : undefined;
				const counterpart = kind ? findPlexCounterpart(library, kind, item) : {};
				return {
					item,
					knownAs: (counterpart.series ?? counterpart.movie)?.title,
					exact: normalizeTitle(item.title) === wanted,
				};
			}),
		];
		const knownAsByKey = new Map<string, string>();
		for (const entry of found) {
			if (entry.knownAs && entry.item.ratingKey && !knownAsByKey.has(entry.item.ratingKey)) {
				knownAsByKey.set(entry.item.ratingKey, entry.knownAs);
			}
		}
		const uniqueResults = deduplicatePlexItems(
			[...found.filter((entry) => entry.exact), ...found.filter((entry) => !entry.exact)].map(
				(entry) => entry.item,
			),
		);

		if (uniqueResults.length === 0) {
			const elsewhere = uniqueNonEmptyStrings(
				libraryHits.map((hit) =>
					hit.series
						? `Sonarr has '${hit.series.title}' (${hit.series.year}) with ${hit.series.statistics?.episodeFileCount ?? 0} of ${hit.series.statistics?.episodeCount ?? 0} episodes downloaded.`
						: hit.movie
							? `Radarr has '${hit.movie.title}' (${hit.movie.year}), ${hit.movie.hasFile ? "with its file downloaded" : "not downloaded yet"}.`
							: undefined,
				),
			).join(" ");

			if (library.plex === null) {
				return {
					message: `The Plex library could not be checked for '${normalizedQuery}' right now. Do not tell the user the title is missing: say the check failed and offer to try again.${elsewhere ? ` ${elsewhere}` : ""}`,
				} as any;
			}
			if (elsewhere) {
				return {
					message: `'${normalizedQuery}' is not in Plex. ${elsewhere}`,
				} as any;
			}
			return {
				message: `No results found in Plex library for '${normalizedQuery}'.${lookupFailed ? " Titles in other languages could not be resolved right now, so it may be listed under another name." : ""}`,
			} as any;
		}

		const items = uniqueResults.slice(0, 5);
		return (await Promise.all(
			items.map(async (m) => {
				const ids = plexExternalIds(m);
				const knownAs = knownAsByKey.get(m.ratingKey);
				const countries = m.ratingKey
					? await plex.getItemCountryTags(String(m.ratingKey))
					: [];

				return {
					title: m.title,
					...(knownAs && normalizeTitle(knownAs) !== normalizeTitle(m.title)
						? { alsoKnownAs: knownAs }
						: {}),
					type: m.type,
					mediaType:
						m.type === "movie"
							? "[Movie]"
							: m.type === "show"
								? "[Show]"
								: `[${m.type}]`,
					year: m.year,
					overview: m.summary,
					imdbId: ids.imdb,
					tmdbId: ids.tmdb,
					tvdbId: ids.tvdb,
					originalTitle: m.originalTitle,
					countries,
					primaryCountry: countries[0],
					posterUrl: plex.getPosterUrl(m.thumb),
				};
			}),
		)) as any;
	},
});

export const browsePlexByGenreTool = tool({
	description:
		"Find movies or shows in the Plex library that match a specific genre (e.g., Horror, Comedy).",
	parameters: z.object({
		genre: z.string().describe("The genre to browse for."),
	}),
	execute: async ({ genre }: { genre: string }) => {
		const sectionIds = await plex.getAllSectionIds();

		if (sectionIds.length === 0) {
			return {
				message:
					"Could not find any 'movie' or 'show' sections in your Plex library.",
			};
		}

		const allResults: any[] = [];
		for (const sectionId of sectionIds) {
			try {
				const result = await plex.getItemsByGenre(sectionId, genre);
				if (result.Metadata) {
					allResults.push(...result.Metadata);
				}
			} catch (error) {
				console.error(
					`Error browsing section ${sectionId} for genre ${genre}:`,
					error,
				);
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
			sampleItems: uniqueResults.slice(0, 15).map((m) => ({
				title: m.title,
				mediaType:
					m.type === "movie"
						? "[Movie]"
						: m.type === "show"
							? "[Show]"
							: `[${m.type}]`,
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
		return result.Metadata.slice(0, 5).map((m) => ({
			title: m.grandparentTitle
				? `${m.grandparentTitle} - ${m.title}`
				: m.title,
			type: m.type,
		})) as any;
	},
});

export const findPlexByCountryTool = tool({
	description:
		"Find movies or shows in the Plex library that match a specific country of origin (e.g., Japan, France, USA). Use this for ANY query involving a country or nationality, such as 'Japanese series', 'French movies', 'films from Italy', or 'Japanese schoolgirls'.",
	parameters: z.object({
		country: z
			.string()
			.transform((value) => plex.normalizeCountryName(value))
			.describe(
				"The country to browse for as a noun or adjective (e.g., Germany, French, Japan, Japanese).",
			),
		ranked: z
			.boolean()
			.optional()
			.describe("Set to true when the user asks for top/best/ranked movies."),
		limit: z
			.number()
			.int()
			.min(1)
			.max(25)
			.nullable()
			.optional()
			.describe("How many items to return in sampleItems (e.g., top 10)."),
	}),
	execute: async ({
		country,
		ranked = false,
		limit,
	}: {
		country: string;
		ranked?: boolean;
		limit?: number | null;
	}) => {
		const effectiveLimit = limit ?? 15;
		const sectionIds = await plex.getAllSectionIds();

		if (sectionIds.length === 0) {
			return {
				message:
					"Could not find any 'movie' or 'show' sections in your Plex library.",
			};
		}

		const allResults: any[] = [];
		for (const sectionId of sectionIds) {
			try {
				const result = await plex.getItemsByCountry(sectionId, country);
				if (result.Metadata) {
					allResults.push(...result.Metadata);
				}
			} catch (error) {
				console.error(
					`Error browsing section ${sectionId} for country ${country}:`,
					error,
				);
			}
		}

		const uniqueResults = deduplicatePlexItems(allResults);
		const strictCountryResults = await plex.filterItemsByCountryTag(
			uniqueResults,
			country,
			{ primaryOnly: false },
		);

		if (strictCountryResults.length === 0) {
			return {
				totalFound: 0,
				sampleItems: [],
				message: `No items found in your Plex library for country '${country}' across checked sections.`,
			} as any;
		}

		const rankScore = (item: any): number => {
			if (typeof item?.rating === "number" && Number.isFinite(item.rating))
				return item.rating;
			if (
				typeof item?.audienceRating === "number" &&
				Number.isFinite(item.audienceRating)
			)
				return item.audienceRating;
			if (
				typeof item?.userRating === "number" &&
				Number.isFinite(item.userRating)
			)
				return item.userRating;
			return Number.NEGATIVE_INFINITY;
		};

		const orderedResults = ranked
			? [...strictCountryResults].sort((a, b) => rankScore(b) - rankScore(a))
			: strictCountryResults;

		const sampleItems = await Promise.all(
			orderedResults.slice(0, effectiveLimit).map(async (m) => {
				let enrichedOriginalTitle = m.originalTitle;
				let aliasTitle =
					typeof m.titleSort === "string" ? m.titleSort.trim() : undefined;

				if (m.ratingKey) {
					try {
						const details = await plex.getItemMetadata(String(m.ratingKey));
						const detailOriginalTitle =
							typeof details?.originalTitle === "string"
								? details.originalTitle.trim()
								: "";
						const detailTitleSort =
							typeof details?.titleSort === "string"
								? details.titleSort.trim()
								: "";
						if (detailOriginalTitle) {
							enrichedOriginalTitle = detailOriginalTitle;
						}
						if (detailTitleSort) aliasTitle = detailTitleSort;
					} catch {
						// Best-effort enrichment only.
					}
				}

				const currentTitle = String(m.title || "").trim();
				const currentAlias = pickLatinAliasCandidate(
					[enrichedOriginalTitle, aliasTitle],
					currentTitle,
				);
				if (
					currentTitle &&
					hasNonLatinCharacters(currentTitle) &&
					!currentAlias
				) {
					try {
						const lookup = await radarr.searchMovie(currentTitle);
						const yearMatch =
							lookup.find((item) => item.year === m.year) || lookup[0];
						if (yearMatch) {
							const radarrAlias = pickLatinAliasCandidate(
								[yearMatch.originalTitle, yearMatch.title],
								currentTitle,
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
					mediaType:
						m.type === "movie"
							? "[Movie]"
							: m.type === "show"
								? "[Show]"
								: `[${m.type}]`,
					originalTitle: enrichedOriginalTitle,
					aliasTitle,
					year: m.year,
					overview: m.summary,
					posterUrl: plex.getPosterUrl(m.thumb),
				};
			}),
		);

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
	description:
		"Find MOVIES in Plex that match a specific duration. Useful when the user asks for 'short movies under X minutes'. This tool only searches movie libraries.",
	parameters: z.object({
		comparison: z
			.enum(["shorterThan", "longerThan", "between"])
			.describe("How to compare the duration."),
		minutes: z
			.number()
			.int()
			.min(1)
			.describe(
				"The duration in minutes for comparison (max value for 'shorterThan', min value for 'longerThan').",
			),
		minutesMax: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("Maximum duration for 'between' comparison."),
		limit: z
			.number()
			.int()
			.min(1)
			.max(50)
			.nullable()
			.optional()
			.describe("How many items to return in sampleItems (e.g., top 10)."),
	}),
	execute: async ({
		comparison,
		minutes,
		minutesMax,
		limit,
	}: {
		comparison: string;
		minutes: number;
		minutesMax?: number;
		limit?: number | null;
	}) => {
		let sectionIds = plex.getMovieSectionIds();

		if (sectionIds.length === 0) {
			const sections = await plex.getLibrarySections();
			sectionIds =
				(sections.Directory as any[])
					?.filter((d) => d.type === "movie")
					.map((d) => d.key) || [];
		}

		if (sectionIds.length === 0) {
			return {
				message: "Could not find any 'movie' sections in your Plex library.",
			};
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
							} else if (
								comparison === "longerThan" &&
								durationMinutes > minutes
							) {
								matches = true;
							} else if (
								comparison === "between" &&
								minutesMax &&
								durationMinutes >= minutes &&
								durationMinutes <= minutesMax
							) {
								matches = true;
							}

							if (matches) {
								allResults.push({
									...item,
									durationMinutes,
								});
							}
						}
					}
				}
			} catch (error) {
				console.error(
					`Error searching section ${sectionId} by duration:`,
					error,
				);
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
				message: `No movies found in your Plex library ${queryDesc}.`,
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
		const sampleItems = sortedResults.slice(0, effectiveLimit).map((m) => ({
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
	description:
		"Get statistics about the Plex library, summarizing content by section type across all library sections.",
	parameters: z.object({}),
	execute: async (_args: any) => {
		const sections = await plex.getLibrarySections();
		if (!sections.Directory || sections.Directory.length === 0) {
			return {
				totalMovies: 0,
				totalShows: 0,
				message: "No library sections found in Plex.",
			};
		}

		const counts = await Promise.all(
			(sections.Directory as any[]).map(async (d) => {
				const size = await plex.getLibrarySize(d.key);
				return { type: d.type, size };
			}),
		);

		const totalMovies = counts
			.filter((c) => c.type === "movie")
			.reduce((acc, c) => acc + c.size, 0);
		const totalShows = counts
			.filter((c) => c.type === "show")
			.reduce((acc, c) => acc + c.size, 0);

		return {
			totalMovies,
			totalShows,
			message: `You have ${totalMovies} movies and ${totalShows} TV shows in your Plex library across all ${sections.Directory.length} sections.`,
		};
	},
});

export const getUnwatchedEpisodesTool = tool({
	description:
		"Get a list of unwatched episodes for a specific series in Plex. Requires the Plex 'ratingKey' of the series, which can be obtained by searching with 'searchPlexByTitleOnly'.",
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
				episodes: episodes.map((e) => ({
					title: e.title,
					season: e.parentIndex,
					episode: e.index,
					summary: e.summary,
				})),
			};
		} catch (error: any) {
			return {
				message: `Failed to fetch unwatched episodes: ${error.message || "Unknown error"}`,
			};
		}
	},
});

export const getPlexSessionsTool = tool({
	description:
		"Get currently active playback sessions on Plex. Shows title, playback state (playing, paused), user name, player/device, and playback progress.",
	parameters: z.object({}),
	execute: async () => {
		try {
			const sessions = await plex.getPlexSessions();
			if (sessions.length === 0) {
				return { message: "No active playback sessions found on Plex." };
			}
			return {
				sessions: sessions.map((s) => ({
					title: s.title,
					type: s.type,
					state: s.state,
					user: s.user,
					player: s.player,
					progress: `${s.progressPercent}% (${formatDuration(Math.floor(s.viewOffset / 1000))} / ${formatDuration(Math.floor(s.duration / 1000))})`,
				})),
			};
		} catch (error: any) {
			return {
				message: `Failed to fetch Plex sessions: ${error.message || "Unknown error"}`,
			};
		}
	},
});
