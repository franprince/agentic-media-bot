import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as plex from "../../services/plex";
import * as radarr from "../../services/radarr";
import * as sonarr from "../../services/sonarr";
import {
	addMovieTool,
	addSeriesTool,
	getDiskSpaceTool,
	getPlexSessionsTool,
} from "../tools";

describe("Plex Sessions Parser", () => {
	let getPlexSessionsSpy: any;

	beforeAll(() => {
		getPlexSessionsSpy = spyOn(plex, "getPlexSessions");
	});

	afterAll(() => {
		getPlexSessionsSpy.mockRestore();
	});

	test("should parse movie sessions and calculate progress percentage", async () => {
		getPlexSessionsSpy.mockImplementation(async () => [
			{
				sessionKey: "session_1",
				title: "Inception (2010)",
				type: "movie",
				state: "playing",
				user: "fran",
				player: "Web Client",
				viewOffset: 3600000, // 1 hour
				duration: 7200000, // 2 hours
				progressPercent: 50.0,
			},
		]);

		const result = await getPlexSessionsTool.execute!({}, {} as any);
		expect(result.sessions).toBeDefined();
		expect(result.sessions!.length).toBe(1);
		expect(result.sessions![0].title).toBe("Inception (2010)");
		expect(result.sessions![0].progress).toContain("50%");
	});

	test("should parse episode sessions and format show name + season + episode", async () => {
		getPlexSessionsSpy.mockImplementation(async () => [
			{
				sessionKey: "session_2",
				title: "The Boys - S01E03 - Cherry",
				type: "episode",
				state: "paused",
				user: "anna",
				player: "Apple TV",
				viewOffset: 1200000,
				duration: 3600000,
				progressPercent: 33.3,
			},
		]);

		const result = await getPlexSessionsTool.execute!({}, {} as any);
		expect(result.sessions).toBeDefined();
		expect(result.sessions!.length).toBe(1);
		expect(result.sessions![0].title).toBe("The Boys - S01E03 - Cherry");
		expect(result.sessions![0].state).toBe("paused");
		expect(result.sessions![0].progress).toContain("33.3%");
	});
});

describe("Disk Space Query aggregation", () => {
	let getRadarrFoldersSpy: any;
	let getSonarrFoldersSpy: any;

	beforeAll(() => {
		getRadarrFoldersSpy = spyOn(radarr, "getRootFolders");
		getSonarrFoldersSpy = spyOn(sonarr, "getRootFolders");
	});

	afterAll(() => {
		getRadarrFoldersSpy.mockRestore();
		getSonarrFoldersSpy.mockRestore();
	});

	test("should fetch and format folders across Radarr and Sonarr", async () => {
		getRadarrFoldersSpy.mockImplementation(async () => [
			{ id: 1, path: "/movies", freeSpace: 100 * 1024 * 1024 * 1024 }, // 100 GB
		]);
		getSonarrFoldersSpy.mockImplementation(async () => [
			{ id: 1, path: "/tv", freeSpace: 50 * 1024 * 1024 * 1024 }, // 50 GB
		]);

		const result = await getDiskSpaceTool.execute!({}, {} as any);
		expect(result.folders).toBeDefined();
		expect(result.folders!.length).toBe(2);

		const radarrFolder = result.folders!.find((f) => f.service === "Radarr");
		expect(radarrFolder).toBeDefined();
		expect(radarrFolder!.freeSpace).toBe("100 GB");

		const sonarrFolder = result.folders!.find((f) => f.service === "Sonarr");
		expect(sonarrFolder).toBeDefined();
		expect(sonarrFolder!.freeSpace).toBe("50 GB");
	});
});

describe("Tags resolution and add tools", () => {
	let getRadarrTagsSpy: any;
	let createRadarrTagSpy: any;
	let addMovieSpy: any;
	let searchMovieSpy: any;
	let getQualityProfilesSpy: any;
	let getRootFoldersSpy: any;

	beforeAll(() => {
		getRadarrTagsSpy = spyOn(radarr, "getTags");
		createRadarrTagSpy = spyOn(radarr, "createTag");
		addMovieSpy = spyOn(radarr, "addMovie");
		searchMovieSpy = spyOn(radarr, "searchMovie");
		getQualityProfilesSpy = spyOn(
			radarr,
			"getQualityProfiles",
		).mockImplementation(async () => [{ id: 1, name: "HD-1080p" }]);
		getRootFoldersSpy = spyOn(radarr, "getRootFolders").mockImplementation(
			async () => [
				{ id: 1, path: "/movies", freeSpace: 1024 * 1024 * 1024 * 10 },
			],
		);
	});

	afterAll(() => {
		getRadarrTagsSpy.mockRestore();
		createRadarrTagSpy.mockRestore();
		addMovieSpy.mockRestore();
		searchMovieSpy.mockRestore();
		getQualityProfilesSpy.mockRestore();
		getRootFoldersSpy.mockRestore();
	});

	test("should resolve existing tags and create new tags if missing", async () => {
		// Mock existing tag list
		getRadarrTagsSpy.mockImplementation(async () => [
			{ id: 1, label: "existing-tag" },
		]);

		// Mock tag creation for new tag
		createRadarrTagSpy.mockImplementation(async (label: string) => {
			return { id: 2, label };
		});

		const tagIds = await radarr.resolveTagIds(["existing-tag", "new-tag"]);
		expect(tagIds).toEqual([1, 2]);
	});

	test("addMovieTool should pass resolved tag IDs to addMovie service", async () => {
		// Mock search to find Inception
		searchMovieSpy.mockImplementation(async () => [
			{ tmdbId: 27205, title: "Inception", year: 2010, images: [] },
		]);

		// Mock tags
		getRadarrTagsSpy.mockImplementation(async () => [{ id: 1, label: "4k" }]);

		// Spy on service call
		let passedTags: number[] | undefined;
		addMovieSpy.mockImplementation(
			async (tmdbId, title, year, path, profileId, tags) => {
				passedTags = tags;
				return { title: "Inception", tmdbId: 27205 };
			},
		);

		// Execute addMovieTool with confirm = true and tags
		await addMovieTool.execute!(
			{
				tmdbId: 27205,
				title: "Inception",
				year: 2010,
				confirm: true,
				tags: ["4k"],
				qualityProfileId: 1,
				rootFolderPath: "/movies",
			},
			{} as any,
		);

		expect(passedTags).toEqual([1]);
	});
});
