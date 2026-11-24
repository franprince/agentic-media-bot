import type { PlexMetadata } from "../types/plex";
import type { RadarrMovie } from "../types/radarr";
import type { SonarrSeries } from "../types/sonarr";
import * as plex from "./plex";
import * as radarr from "./radarr";
import * as sonarr from "./sonarr";

export type LibraryKind = "movie" | "show";

export interface ExternalIds {
	imdb?: string;
	tmdb?: string;
	tvdb?: string;
}

export interface PlexLibraryItem {
	kind: LibraryKind;
	ids: ExternalIds;
	item: PlexMetadata;
}

/** What the library holds right now. A source that could not be read is null. */
export interface LibrarySnapshot {
	plex: PlexLibraryItem[] | null;
	series: SonarrSeries[] | null;
	movies: RadarrMovie[] | null;
}

export interface LibraryQuery {
	kind: LibraryKind;
	tmdbId?: number | string | null;
	tvdbId?: number | string | null;
	imdbId?: string | null;
	title?: string | null;
	originalTitle?: string | null;
	year?: number | null;
}

export interface LibraryMatch {
	plex?: PlexMetadata;
	series?: SonarrSeries;
	movie?: RadarrMovie;
	/** true: found. false: every source answered and none has it. null: not found, and a source could not be read. */
	inLibrary: boolean | null;
	inPlex: boolean | null;
}

export interface LibraryTitleHit {
	kind: LibraryKind;
	/** The title Sonarr or Radarr uses, or the Plex title when neither has the item. */
	knownAs: string;
	exact: boolean;
	plex?: PlexMetadata;
	series?: SonarrSeries;
	movie?: RadarrMovie;
}

const ID_KINDS = ["imdb", "tmdb", "tvdb"] as const;

const GUID_PATTERN = /(imdb|tmdb|themoviedb|tvdb|thetvdb):\/\/(tt\d+|\d+)/;

/**
 * External ids of a Plex item. The current agents list them in `Guid`
 * (`guid` is then an opaque "plex://…"); the legacy agents put one in `guid`.
 */
export function plexExternalIds(item: { guid?: string; Guid?: Array<{ id: string }> }): ExternalIds {
	const ids: ExternalIds = {};
	for (const raw of [...(item.Guid ?? []).map((guid) => guid.id), item.guid]) {
		const match = raw?.match(GUID_PATTERN);
		if (!match) continue;
		const [, scheme, value] = match;
		const kind = scheme === "themoviedb" ? "tmdb" : scheme === "thetvdb" ? "tvdb" : (scheme as keyof ExternalIds);
		if (value && !ids[kind]) ids[kind] = value;
	}
	return ids;
}

function toIds(source: {
	tmdbId?: number | string | null;
	tvdbId?: number | string | null;
	imdbId?: string | null;
}): ExternalIds {
	const ids: ExternalIds = {};
	if (source.imdbId) ids.imdb = String(source.imdbId);
	if (source.tmdbId) ids.tmdb = String(source.tmdbId);
	if (source.tvdbId) ids.tvdb = String(source.tvdbId);
	return ids;
}

/** true or false when the two share a kind of id; null when there is nothing to compare. */
function sameIds(a: ExternalIds, b: ExternalIds): boolean | null {
	let comparable = false;
	for (const kind of ID_KINDS) {
		if (!a[kind] || !b[kind]) continue;
		if (a[kind] === b[kind]) return true;
		comparable = true;
	}
	return comparable ? false : null;
}

export function normalizeTitle(value: string | null | undefined): string {
	return (value ?? "")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function sameTitleAndYear(
	query: LibraryQuery,
	titles: Array<string | null | undefined>,
	year: number | null | undefined,
): boolean {
	if (!query.year || !year || Math.abs(query.year - year) > 1) return false;
	const wanted = [query.title, query.originalTitle].map(normalizeTitle).filter(Boolean);
	return titles.map(normalizeTitle).some((title) => title && wanted.includes(title));
}

/** Ids decide when both sides have a common kind; title and year only when they do not. */
function matches(
	query: LibraryQuery,
	ids: ExternalIds,
	titles: Array<string | null | undefined>,
	year: number | null | undefined,
): boolean {
	return sameIds(toIds(query), ids) ?? sameTitleAndYear(query, titles, year);
}

function arrTitles(entry: SonarrSeries | RadarrMovie): Array<string | undefined> {
	return [entry.title, entry.originalTitle, ...(entry.alternateTitles ?? []).map((alt) => alt.title)];
}

export function findInLibrary(snapshot: LibrarySnapshot, query: LibraryQuery): LibraryMatch {
	const plexMatch = snapshot.plex?.find(
		(entry) =>
			entry.kind === query.kind &&
			matches(query, entry.ids, [entry.item.title, entry.item.originalTitle], entry.item.year),
	)?.item;
	const arr = query.kind === "show" ? snapshot.series : snapshot.movies;
	const arrMatch = (arr as Array<SonarrSeries | RadarrMovie> | null)?.find((entry) =>
		matches(query, toIds(entry), arrTitles(entry), entry.year),
	);

	const found = Boolean(plexMatch || arrMatch);
	const everySourceAnswered = snapshot.plex !== null && arr !== null;
	return {
		plex: plexMatch,
		series: query.kind === "show" ? (arrMatch as SonarrSeries | undefined) : undefined,
		movie: query.kind === "movie" ? (arrMatch as RadarrMovie | undefined) : undefined,
		inLibrary: found ? true : everySourceAnswered ? false : null,
		inPlex: plexMatch ? true : snapshot.plex === null ? null : false,
	};
}

/** The Sonarr or Radarr entry of a Plex item, which carries the title the user knows it by. */
export function findPlexCounterpart(
	snapshot: LibrarySnapshot,
	kind: LibraryKind,
	item: PlexMetadata,
): Pick<LibraryMatch, "series" | "movie"> {
	const ids = plexExternalIds(item);
	const { series, movie } = findInLibrary(
		{ ...snapshot, plex: [] },
		{
			kind,
			imdbId: ids.imdb,
			tmdbId: ids.tmdb,
			tvdbId: ids.tvdb,
			title: item.title,
			originalTitle: item.originalTitle,
			year: item.year,
		},
	);
	return { series, movie };
}

/** "exact", "partial" (the query is a run of whole words in the title) or null. */
function titleMatch(query: string, titles: Array<string | null | undefined>): "exact" | "partial" | null {
	let partial = false;
	for (const title of titles.map(normalizeTitle)) {
		if (!title) continue;
		if (title === query) return "exact";
		if (query.length >= 3 && ` ${title} `.includes(` ${query} `)) partial = true;
	}
	return partial ? "partial" : null;
}

/**
 * Library items whose title matches the query under any name Plex, Sonarr or
 * Radarr knows them by. Plex lists many items under their original-language
 * title, which its own title search cannot reach from the English one.
 */
export function searchLibraryTitles(snapshot: LibrarySnapshot, rawQuery: string): LibraryTitleHit[] {
	const query = normalizeTitle(rawQuery);
	if (!query) return [];

	const hits: LibraryTitleHit[] = [];
	const seenPlex = new Set<string>();

	const addArr = (kind: LibraryKind, entries: Array<SonarrSeries | RadarrMovie> | null) => {
		for (const entry of entries ?? []) {
			const found = titleMatch(query, arrTitles(entry));
			if (!found) continue;
			const plexItem = snapshot.plex?.find(
				(candidate) =>
					candidate.kind === kind &&
					matches(
						{ kind, ...entry, year: entry.year },
						candidate.ids,
						[candidate.item.title, candidate.item.originalTitle],
						candidate.item.year,
					),
			)?.item;
			if (plexItem) seenPlex.add(plexItem.ratingKey);
			hits.push({
				kind,
				knownAs: entry.title,
				exact: found === "exact",
				plex: plexItem,
				series: kind === "show" ? (entry as SonarrSeries) : undefined,
				movie: kind === "movie" ? (entry as RadarrMovie) : undefined,
			});
		}
	};
	addArr("show", snapshot.series);
	addArr("movie", snapshot.movies);

	for (const entry of snapshot.plex ?? []) {
		if (seenPlex.has(entry.item.ratingKey)) continue;
		const found = titleMatch(query, [entry.item.title, entry.item.originalTitle]);
		if (!found) continue;
		const { series, movie } = findPlexCounterpart(snapshot, entry.kind, entry.item);
		hits.push({
			kind: entry.kind,
			knownAs: (series ?? movie)?.title ?? entry.item.title,
			exact: found === "exact",
			plex: entry.item,
			series,
			movie,
		});
	}

	return hits.sort((a, b) => Number(b.exact) - Number(a.exact));
}

async function plexSections(): Promise<Array<{ id: string; kind: LibraryKind }>> {
	const movieIds = plex.getMovieSectionIds().filter(Boolean);
	const showIds = plex.getShowSectionIds().filter(Boolean);
	if (movieIds.length > 0 || showIds.length > 0) {
		return [
			...movieIds.map((id) => ({ id, kind: "movie" as const })),
			...showIds.map((id) => ({ id, kind: "show" as const })),
		];
	}
	const sections = await plex.getLibrarySections();
	return (sections.Directory ?? [])
		.filter((directory) => directory.type === "movie" || directory.type === "show")
		.map((directory) => ({ id: directory.key, kind: directory.type as LibraryKind }));
}

async function loadPlexItems(): Promise<PlexLibraryItem[]> {
	const sections = await plexSections();
	const lists = await Promise.all(
		sections.map(async ({ id, kind }) =>
			(await plex.getLibraryItems(id, kind)).map((item) => ({ kind, ids: plexExternalIds(item), item })),
		),
	);
	return lists.flat();
}

async function readSource<T>(name: string, read: () => Promise<T>): Promise<T | null> {
	try {
		return await read();
	} catch (error: any) {
		console.warn(`⚠️ Library check: could not read ${name}: ${error?.message ?? error}`);
		return null;
	}
}

/**
 * Reads the library from Plex, Sonarr and Radarr. These are local listings:
 * no title search and no metadata lookup, so the answer does not depend on a
 * title spelling or on an outside service being up.
 */
export async function loadLibrary(): Promise<LibrarySnapshot> {
	const [plexItems, series, movies] = await Promise.all([
		readSource("Plex", loadPlexItems),
		readSource("Sonarr", () => sonarr.getAllSeries()),
		readSource("Radarr", () => radarr.getAllMovies()),
	]);
	return { plex: plexItems, series, movies };
}
