import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as plex from "../../services/plex";
import * as radarr from "../../services/radarr";
import * as sonarr from "../../services/sonarr";
import * as tmdb from "../../services/tmdb";
import {
	discoverMediaTool,
	searchMovieTool,
	searchPlexByTitleOnlyTool,
	searchSeriesTool,
} from "../tools";

/** A series Plex lists under its original-language title; Sonarr has all its episodes. */
const plexShow: any = {
	ratingKey: "501",
	type: "show",
	title: "항구의 불빛",
	originalTitle: "항구의 불빛",
	year: 2026,
	summary: "A harbor town keeps a secret.",
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
	monitored: true,
	statistics: { episodeFileCount: 10, episodeCount: 10, percentOfEpisodes: 100 },
};
/** What Sonarr's lookup returns for the same series: the id is set, the statistics are empty. */
const sonarrLookupHit: any = {
	...sonarrShow,
	statistics: { episodeFileCount: 0, episodeCount: 0, percentOfEpisodes: 0 },
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
	monitored: true,
};

let library: { plex: any[] | "fail"; series: any[] | "fail"; movies: any[] | "fail" };
let plexSearchHits: any[];
let seriesLookup: any[] | "fail";
let movieLookup: any[] | "fail";

const spies: Record<string, any> = {};
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
	for (const key of ["PLEX_MOVIE_SECTION_IDS", "PLEX_SHOW_SECTION_IDS", "PLEX_URL", "PLEX_TOKEN"]) {
		savedEnv[key] = process.env[key];
	}
	process.env.PLEX_MOVIE_SECTION_IDS = "1";
	process.env.PLEX_SHOW_SECTION_IDS = "2";
	process.env.PLEX_URL = "http://localhost:32400";
	process.env.PLEX_TOKEN = "test_token";

	const listing = (source: any[] | "fail") => {
		if (source === "fail") throw new Error("service unavailable");
		return source;
	};
	spies.getLibraryItems = spyOn(plex, "getLibraryItems").mockImplementation(async (_id: string, kind: any) =>
		listing(library.plex).filter((item: any) => item.type === kind),
	);
	spies.getAllSeries = spyOn(sonarr, "getAllSeries").mockImplementation(async () => listing(library.series));
	spies.getAllMovies = spyOn(radarr, "getAllMovies").mockImplementation(async () => listing(library.movies));
	spies.searchPlex = spyOn(plex, "searchPlex").mockImplementation(
		async () => ({ size: plexSearchHits.length, Metadata: plexSearchHits }) as any,
	);
	spies.getItemCountryTags = spyOn(plex, "getItemCountryTags").mockImplementation(async () => []);
	spies.searchSeries = spyOn(sonarr, "searchSeries").mockImplementation(async () => listing(seriesLookup));
	spies.searchMovie = spyOn(radarr, "searchMovie").mockImplementation(async () => listing(movieLookup));
	spies.discoverMedia = spyOn(tmdb, "discoverMedia");
	spies.warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
	for (const spy of Object.values(spies)) spy.mockRestore();
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

beforeEach(() => {
	library = { plex: [plexShow, plexMovie], series: [sonarrShow], movies: [radarrMovie] };
	plexSearchHits = [];
	seriesLookup = [];
	movieLookup = [];
});

afterEach(() => {
	for (const name of ["searchPlex", "searchSeries", "searchMovie"]) spies[name].mockClear();
});

function suggestion(overrides: Record<string, unknown>) {
	return {
		id: 800001,
		title: "Harbor Lights",
		mediaType: "tv",
		year: 2026,
		overview: "A harbor town keeps a secret.",
		rating: 8.4,
		voteCount: 1200,
		genres: ["Drama"],
		posterPath: "/harbor.jpg",
		...overrides,
	};
}

async function discover(results: any[]) {
	spies.discoverMedia.mockImplementation(async () => results);
	return (await discoverMediaTool.execute!({ query: "drama series" }, {} as any)) as any;
}

describe("discoverMedia: the query", () => {
	test("is described without a year, and a year is added only when the user names one", () => {
		const query = (discoverMediaTool.parameters as any).shape.query.description as string;

		expect(query).not.toMatch(/20\d\d/);
		expect(query).toContain("only if the user names one");
	});
});

describe("discoverMedia: is a suggestion already in the library?", () => {
	test("yes for a series that Plex lists under another title", async () => {
		const result = await discover([suggestion({})]);

		expect(result.suggestions[0].alreadyInLibrary).toBe(true);
	});

	test("answers from the library listings, without a title search or a metadata lookup", async () => {
		await discover([suggestion({})]);

		expect(spies.searchPlex).not.toHaveBeenCalled();
		expect(spies.searchSeries).not.toHaveBeenCalled();
		expect(spies.searchMovie).not.toHaveBeenCalled();
	});

	test("yes for a series Sonarr has that Plex has not picked up", async () => {
		library.plex = [];

		expect((await discover([suggestion({})])).suggestions[0].alreadyInLibrary).toBe(true);
	});

	test("no for a title that is in none of the listings", async () => {
		const result = await discover([suggestion({ id: 812345, title: "Somewhere Else" })]);

		expect(result.suggestions[0].alreadyInLibrary).toBe(false);
	});

	test("no for a series whose TMDB id is the id of a movie in the library", async () => {
		const result = await discover([suggestion({ id: 800002, title: "Unrelated Series", year: 2024 })]);

		expect(result.suggestions[0].alreadyInLibrary).toBe(false);
	});

	test("unknown, never no, when the library could not be read", async () => {
		library = { plex: "fail", series: "fail", movies: "fail" };

		const result = await discover([suggestion({})]);

		expect(result.suggestions[0].alreadyInLibrary).toBeNull();
		expect(result.note).toContain("could not be checked");
	});

	test("unknown when only Sonarr failed and Plex does not have the series", async () => {
		library.plex = [];
		library.series = "fail";

		expect((await discover([suggestion({})])).suggestions[0].alreadyInLibrary).toBeNull();
	});

	test("says nothing about a failed check when every check worked", async () => {
		expect((await discover([suggestion({})])).note).not.toContain("could not be checked");
	});
});

describe("searchSeries: is the series already in Sonarr and Plex?", () => {
	test("reports a series Sonarr already has, with the episodes on disk", async () => {
		seriesLookup = [sonarrLookupHit];

		const [hit] = (await searchSeriesTool.execute!({ term: "Harbor Lights" }, {} as any)) as any;

		expect(hit.alreadyInSonarr).toBe(true);
		expect(hit.episodesDownloaded).toBe("10 of 10");
	});

	test("finds it in Plex by id although the Plex title is different, and gives that title", async () => {
		seriesLookup = [sonarrLookupHit];

		const [hit] = (await searchSeriesTool.execute!({ term: "Harbor Lights" }, {} as any)) as any;

		expect(hit.alreadyInPlex).toBe(true);
		expect(hit.plexTitle).toBe("항구의 불빛");
		expect(spies.searchPlex).not.toHaveBeenCalled();
	});

	test("reports a series that is in neither", async () => {
		seriesLookup = [{ title: "Somewhere Else", year: 2024, tvdbId: 912345, monitored: true }];

		const [hit] = (await searchSeriesTool.execute!({ term: "Somewhere Else" }, {} as any)) as any;

		expect(hit.alreadyInSonarr).toBe(false);
		expect(hit.alreadyInPlex).toBe(false);
		expect(hit.plexTitle).toBeUndefined();
		expect(hit.episodesDownloaded).toBeUndefined();
	});

	test("says unknown for Plex when Plex could not be read", async () => {
		library.plex = "fail";
		seriesLookup = [sonarrLookupHit];

		const [hit] = (await searchSeriesTool.execute!({ term: "Harbor Lights" }, {} as any)) as any;

		expect(hit.alreadyInPlex).toBeNull();
		expect(hit.alreadyInSonarr).toBe(true);
	});
});

describe("searchMovie: is the movie already in Radarr and Plex?", () => {
	test("reports a movie Radarr already has and finds it in Plex by id", async () => {
		movieLookup = [{ ...radarrMovie, hasFile: false }];

		const [hit] = (await searchMovieTool.execute!({ term: "Paper Lanterns" }, {} as any)) as any;

		expect(hit.alreadyInRadarr).toBe(true);
		expect(hit.hasFile).toBe(true);
		expect(hit.alreadyInPlex).toBe(true);
		expect(hit.plexTitle).toBe("紙の灯籠");
		expect(spies.searchPlex).not.toHaveBeenCalled();
	});

	test("reports a movie that is in neither", async () => {
		movieLookup = [{ title: "Somewhere Else", year: 2024, tmdbId: 812345, hasFile: false }];

		const [hit] = (await searchMovieTool.execute!({ term: "Somewhere Else" }, {} as any)) as any;

		expect(hit.alreadyInRadarr).toBe(false);
		expect(hit.alreadyInPlex).toBe(false);
	});
});

describe("searchPlexByTitleOnly: titles Plex lists in another language", () => {
	test("finds the item through the title Sonarr knows it by", async () => {
		const result = (await searchPlexByTitleOnlyTool.execute!({ query: "Harbor Lights" }, {} as any)) as any;

		expect(result).toHaveLength(1);
		expect(result[0].title).toBe("항구의 불빛");
		expect(result[0].alsoKnownAs).toBe("Harbor Lights");
		expect(result[0].mediaType).toBe("[Show]");
		expect(result[0].imdbId).toBe("tt9000001");
		expect(result[0].tvdbId).toBe("900001");
	});

	test("does so without a metadata lookup", async () => {
		await searchPlexByTitleOnlyTool.execute!({ query: "Harbor Lights" }, {} as any);

		expect(spies.searchSeries).not.toHaveBeenCalled();
		expect(spies.searchMovie).not.toHaveBeenCalled();
	});

	test("adds such an item to what the Plex title search already found, exact title first", async () => {
		plexSearchHits = [{ ratingKey: "777", type: "show", title: "Harbor Lights Z", year: 2028, guid: "plex://show/c" }];

		const result = (await searchPlexByTitleOnlyTool.execute!({ query: "Harbor Lights" }, {} as any)) as any;

		expect(result.map((item: any) => item.title)).toEqual(["항구의 불빛", "Harbor Lights Z"]);
	});

	test("does not list twice an item both searches found", async () => {
		plexSearchHits = [plexShow];

		const result = (await searchPlexByTitleOnlyTool.execute!({ query: "항구의 불빛" }, {} as any)) as any;

		expect(result).toHaveLength(1);
		expect(result[0].alsoKnownAs).toBe("Harbor Lights");
	});

	test("resolves a translated title through a lookup and matches its id", async () => {
		seriesLookup = [{ title: "Harbor Lights", year: 2026, tvdbId: 900001 }];

		const result = (await searchPlexByTitleOnlyTool.execute!({ query: "Las luces del muelle" }, {} as any)) as any;

		expect(result[0].title).toBe("항구의 불빛");
		expect(result[0].alsoKnownAs).toBe("Harbor Lights");
	});

	test("says where a title is when Sonarr has it and Plex does not", async () => {
		library.plex = [];
		library.series = [{ ...sonarrShow, statistics: { episodeFileCount: 0, episodeCount: 10, percentOfEpisodes: 0 } }];

		const result = (await searchPlexByTitleOnlyTool.execute!({ query: "Harbor Lights" }, {} as any)) as any;

		expect(result.message).toContain("not in Plex");
		expect(result.message).toContain("Sonarr");
		expect(result.message).toContain("0 of 10");
	});

	test("says the check failed, not that the title is missing, when Plex could not be read", async () => {
		library.plex = "fail";
		library.series = [];
		library.movies = [];

		const result = (await searchPlexByTitleOnlyTool.execute!({ query: "Harbor Lights" }, {} as any)) as any;

		expect(result.message).toContain("could not be checked");
		expect(result.message).not.toContain("No results found");
	});

	test("keeps the plain not-found answer when everything was read and nothing matches", async () => {
		const result = (await searchPlexByTitleOnlyTool.execute!({ query: "Somewhere Else" }, {} as any)) as any;

		expect(result.message).toBe("No results found in Plex library for 'Somewhere Else'.");
	});

	test("does not call a title missing only because the lookup of other names failed", async () => {
		seriesLookup = "fail";
		movieLookup = "fail";

		const result = (await searchPlexByTitleOnlyTool.execute!({ query: "Somewhere Else" }, {} as any)) as any;

		expect(result.message).toContain("No results found in Plex library for 'Somewhere Else'");
		expect(result.message).toContain("other languages");
	});
});
