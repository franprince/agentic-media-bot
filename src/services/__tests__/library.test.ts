import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
	findInLibrary,
	type LibrarySnapshot,
	loadLibrary,
	plexExternalIds,
	searchLibraryTitles,
} from "../library";
import * as plex from "../plex";
import * as radarr from "../radarr";
import * as sonarr from "../sonarr";

/** A series Plex lists under its original-language title. */
const plexShow: any = {
	ratingKey: "501",
	type: "show",
	title: "항구의 불빛",
	originalTitle: "항구의 불빛",
	year: 2026,
	guid: "plex://show/aaaaaaaaaaaaaaaaaaaaaaaa",
	Guid: [{ id: "imdb://tt9000001" }, { id: "tmdb://800001" }, { id: "tvdb://900001" }],
};
const sonarrShow: any = {
	id: 12,
	title: "Harbor Lights",
	year: 2026,
	tvdbId: 900001,
	tmdbId: 800001,
	imdbId: "tt9000001",
	alternateTitles: [{ title: "Luces del puerto" }],
	statistics: { episodeFileCount: 10, episodeCount: 10, percentOfEpisodes: 100 },
};
const plexMovie: any = {
	ratingKey: "601",
	type: "movie",
	title: "紙の灯籠",
	year: 2019,
	guid: "plex://movie/bbbbbbbbbbbbbbbbbbbbbbbb",
	Guid: [{ id: "imdb://tt9000002" }, { id: "tmdb://800002" }],
};
const radarrMovie: any = {
	id: 31,
	title: "Paper Lanterns",
	originalTitle: "紙の灯籠",
	year: 2019,
	tmdbId: 800002,
	imdbId: "tt9000002",
	hasFile: true,
};

function snapshot(overrides: Partial<LibrarySnapshot> = {}): LibrarySnapshot {
	return {
		plex: [
			{ kind: "show", ids: plexExternalIds(plexShow), item: plexShow },
			{ kind: "movie", ids: plexExternalIds(plexMovie), item: plexMovie },
		],
		series: [sonarrShow],
		movies: [radarrMovie],
		...overrides,
	};
}

describe("plexExternalIds", () => {
	test("reads the Guid list of the current Plex agents", () => {
		expect(plexExternalIds(plexShow)).toEqual({
			imdb: "tt9000001",
			tmdb: "800001",
			tvdb: "900001",
		});
	});

	test("reads the single guid of the legacy agents", () => {
		expect(plexExternalIds({ guid: "com.plexapp.agents.imdb://tt9000003?lang=en" })).toEqual({
			imdb: "tt9000003",
		});
		expect(plexExternalIds({ guid: "com.plexapp.agents.themoviedb://800003?lang=en" })).toEqual({
			tmdb: "800003",
		});
		expect(plexExternalIds({ guid: "com.plexapp.agents.thetvdb://900003?lang=en" })).toEqual({
			tvdb: "900003",
		});
	});

	test("has nothing to read on an unmatched item", () => {
		expect(plexExternalIds({ guid: "local://77" })).toEqual({});
	});
});

describe("findInLibrary", () => {
	test("finds a series that Plex lists under another title, by TMDB id", () => {
		const match = findInLibrary(snapshot(), {
			kind: "show",
			tmdbId: 800001,
			title: "Harbor Lights",
			year: 2026,
		});

		expect(match.inLibrary).toBe(true);
		expect(match.inPlex).toBe(true);
		expect(match.plex?.title).toBe("항구의 불빛");
		expect(match.series?.id).toBe(12);
	});

	test("finds it by TVDB id or IMDb id as well", () => {
		expect(findInLibrary(snapshot(), { kind: "show", tvdbId: 900001 }).inPlex).toBe(true);
		expect(findInLibrary(snapshot(), { kind: "show", imdbId: "tt9000001" }).inPlex).toBe(true);
	});

	test("does not confuse a movie and a series that share a TMDB id", () => {
		const match = findInLibrary(snapshot(), {
			kind: "movie",
			tmdbId: 800001,
			title: "Another Film",
			year: 2026,
		});

		expect(match.inLibrary).toBe(false);
		expect(match.plex).toBeUndefined();
		expect(match.movie).toBeUndefined();
	});

	test("ignores an equal title when the ids say it is another work", () => {
		const match = findInLibrary(snapshot(), {
			kind: "movie",
			tmdbId: 811111,
			title: "Paper Lanterns",
			year: 2019,
		});

		expect(match.inLibrary).toBe(false);
	});

	test("falls back to title and year when an item has no ids to compare", () => {
		const unmatched: any = { ratingKey: "602", type: "movie", title: "Home Video", year: 2001, guid: "local://602" };
		const library = snapshot({
			plex: [{ kind: "movie", ids: {}, item: unmatched }],
			movies: [],
		});

		expect(findInLibrary(library, { kind: "movie", tmdbId: 5, title: "home video", year: 2002 }).inPlex).toBe(true);
		expect(findInLibrary(library, { kind: "movie", tmdbId: 5, title: "Home Video", year: 2010 }).inPlex).toBe(false);
	});

	test("reports a series Sonarr has but Plex does not", () => {
		const match = findInLibrary(snapshot({ plex: [] }), { kind: "show", tvdbId: 900001 });

		expect(match.inLibrary).toBe(true);
		expect(match.inPlex).toBe(false);
		expect(match.series?.title).toBe("Harbor Lights");
	});

	test("answers unknown, not absent, when a source could not be read", () => {
		const noSonarr = snapshot({ series: null });
		const noPlex = snapshot({ plex: null, movies: [] });

		expect(findInLibrary(noSonarr, { kind: "show", tmdbId: 123456 }).inLibrary).toBeNull();
		expect(findInLibrary(noPlex, { kind: "movie", tmdbId: 123456 }).inLibrary).toBeNull();
		expect(findInLibrary(noPlex, { kind: "movie", tmdbId: 123456 }).inPlex).toBeNull();
	});

	test("a source that only holds the other media type does not make the answer unknown", () => {
		expect(findInLibrary(snapshot({ series: null }), { kind: "movie", tmdbId: 123456 }).inLibrary).toBe(false);
	});

	test("still answers yes from the sources that did answer", () => {
		expect(findInLibrary(snapshot({ plex: null }), { kind: "show", tvdbId: 900001 }).inLibrary).toBe(true);
	});
});

describe("searchLibraryTitles", () => {
	test("finds the Plex item through the title Sonarr knows it by", () => {
		const hits = searchLibraryTitles(snapshot(), "harbor lights");

		expect(hits).toHaveLength(1);
		expect(hits[0]?.exact).toBe(true);
		expect(hits[0]?.knownAs).toBe("Harbor Lights");
		expect(hits[0]?.plex?.title).toBe("항구의 불빛");
	});

	test("matches alternate titles and ignores accents and punctuation", () => {
		expect(searchLibraryTitles(snapshot(), "Lucés del Puerto!")[0]?.plex?.ratingKey).toBe("501");
	});

	test("matches the original title Radarr stores", () => {
		expect(searchLibraryTitles(snapshot(), "紙の灯籠")[0]?.knownAs).toBe("Paper Lanterns");
	});

	test("matches whole words inside a longer title, after exact matches", () => {
		const longer: any = { id: 13, title: "Harbor Lights: The Return", year: 2027, tvdbId: 900009 };
		const hits = searchLibraryTitles(snapshot({ series: [longer, sonarrShow] }), "Harbor Lights");

		expect(hits.map((hit) => hit.knownAs)).toEqual(["Harbor Lights", "Harbor Lights: The Return"]);
		expect(searchLibraryTitles(snapshot(), "arbor")).toHaveLength(0);
	});

	test("does not match on a fragment shorter than three characters", () => {
		expect(searchLibraryTitles(snapshot(), "pa")).toHaveLength(0);
	});

	test("lists a title Sonarr has even when Plex does not have it", () => {
		const hits = searchLibraryTitles(snapshot({ plex: [] }), "Harbor Lights");

		expect(hits[0]?.plex).toBeUndefined();
		expect(hits[0]?.series?.id).toBe(12);
	});
});

describe("loadLibrary", () => {
	const spies: any[] = [];
	const savedEnv: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const key of ["PLEX_MOVIE_SECTION_IDS", "PLEX_SHOW_SECTION_IDS"]) savedEnv[key] = process.env[key];
		process.env.PLEX_MOVIE_SECTION_IDS = "1";
		process.env.PLEX_SHOW_SECTION_IDS = "2";
	});

	afterEach(() => {
		for (const spy of spies.splice(0)) spy.mockRestore();
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	function mockSources(options: { plexFails?: boolean; sonarrFails?: boolean } = {}) {
		spies.push(
			spyOn(plex, "getLibraryItems").mockImplementation(async (sectionId: string, kind: any) => {
				if (options.plexFails && sectionId === "2") throw new Error("plex section unavailable");
				return kind === "movie" ? [plexMovie] : [plexShow];
			}),
			spyOn(sonarr, "getAllSeries").mockImplementation(async () => {
				if (options.sonarrFails) throw new Error("sonarr unavailable");
				return [sonarrShow];
			}),
			spyOn(radarr, "getAllMovies").mockImplementation(async () => [radarrMovie]),
			spyOn(console, "warn").mockImplementation(() => {}),
		);
	}

	test("reads every configured Plex section with its media type, plus Sonarr and Radarr", async () => {
		mockSources();

		const library = await loadLibrary();

		expect(library.plex?.map((entry) => [entry.kind, entry.item.ratingKey, entry.ids.tmdb])).toEqual([
			["movie", "601", "800002"],
			["show", "501", "800001"],
		]);
		expect(library.series).toHaveLength(1);
		expect(library.movies).toHaveLength(1);
	});

	test("marks only the source that failed as unreadable", async () => {
		mockSources({ sonarrFails: true });

		const library = await loadLibrary();

		expect(library.series).toBeNull();
		expect(library.plex).toHaveLength(2);
		expect(library.movies).toHaveLength(1);
	});

	test("treats Plex as unreadable when one of its sections fails", async () => {
		mockSources({ plexFails: true });

		expect((await loadLibrary()).plex).toBeNull();
	});
});
