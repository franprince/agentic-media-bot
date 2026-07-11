import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import * as db from "../../services/database";
import * as plex from "../../services/plex";
import * as radarr from "../../services/radarr";
import * as sonarr from "../../services/sonarr";
import {
	formatBytes,
	formatDuration,
	formatEstimatedCompletion,
	getCompletionWallClock,
	searchMovieTool,
	searchSeriesTool,
} from "../tools";

describe("P1 formatting helpers", () => {
	test("formatBytes should format sizes to human-readable string", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1024 * 1.5)).toBe("1.5 KB");
		expect(formatBytes(1024 * 1024 * 2.34)).toBe("2.34 MB");
		expect(formatBytes(1024 * 1024 * 1024 * 12.3)).toBe("12.3 GB");
	});

	test("formatDuration should format seconds to human-readable string", () => {
		expect(formatDuration(0)).toBe("N/A");
		expect(formatDuration(45)).toBe("45s");
		expect(formatDuration(125)).toBe("2m 5s");
		expect(formatDuration(3670)).toBe("1h 1m");
		expect(formatDuration(90000)).toBe("1d 1h");
		expect(formatDuration(9000000)).toBe("N/A"); // Out of bounds safety check
	});

	test("getCompletionWallClock should return localized wall clock time", () => {
		// Mock Date.now to be stable: 2026-07-04T00:00:00.000Z
		const nowMs = new Date("2026-07-04T00:00:00.000Z").getTime();
		const dateSpy = spyOn(Date, "now").mockImplementation(() => nowMs);

		const clockUtc = getCompletionWallClock(3600, "UTC"); // +1 hour -> 01:00:00
		expect(clockUtc).toBe("01:00:00");

		const clockAr = getCompletionWallClock(7200, "America/Buenos_Aires"); // +2 hours to UTC-3 -> 23:00:00 (previous day)
		expect(clockAr).toBe("23:00:00");

		dateSpy.mockRestore();
	});

	test("formatEstimatedCompletion should parse estimated time and append wall-clock time", () => {
		const nowMs = new Date("2026-07-04T00:00:00.000Z").getTime();
		const dateSpy = spyOn(Date, "now").mockImplementation(() => nowMs);

		// Est completion is 30 mins from now
		const estTime = new Date("2026-07-04T00:30:00.000Z").toISOString();
		const formatted = formatEstimatedCompletion(estTime, "UTC");

		expect(formatted).toContain("30m 0s");
		expect(formatted).toContain("00:30:00");

		dateSpy.mockRestore();
	});
});

describe("Plex Search Cross-Check Enrichment", () => {
	let searchPlexSpy: any;
	let searchMovieSpy: any;
	let searchSeriesSpy: any;

	beforeAll(() => {
		searchPlexSpy = spyOn(plex, "searchPlex");
		searchMovieSpy = spyOn(radarr, "searchMovie");
		searchSeriesSpy = spyOn(sonarr, "searchSeries");
	});

	afterAll(() => {
		searchPlexSpy.mockRestore();
		searchMovieSpy.mockRestore();
		searchSeriesSpy.mockRestore();
	});

	test("searchMovieTool should flag movies as alreadyInPlex when found in Plex library", async () => {
		// Mock Radarr search to return Deadpool movie
		searchMovieSpy.mockImplementation(async () => [
			{
				title: "Deadpool",
				originalTitle: "Deadpool",
				year: 2016,
				tmdbId: 293660,
				imdbId: "tt1431045",
				images: [],
				hasFile: false,
				monitored: true,
			},
		]);

		// Mock Plex search to return Deadpool with matching IMDb ID
		searchPlexSpy.mockImplementation(async () => ({
			Metadata: [
				{
					title: "Deadpool",
					year: 2016,
					guid: "imdb://tt1431045",
					thumb: "poster.jpg",
				},
			],
		}));

		const results = await searchMovieTool.execute!(
			{ term: "Deadpool" },
			{} as any,
		);

		expect(results[0].title).toBe("Deadpool");
		expect(results[0].alreadyInPlex).toBe(true);
	});

	test("searchSeriesTool should flag series as alreadyInPlex when found in Plex library", async () => {
		// Mock Sonarr search to return The Boys
		searchSeriesSpy.mockImplementation(async () => [
			{
				title: "The Boys",
				originalTitle: "The Boys",
				year: 2019,
				tvdbId: 355567,
				imdbId: "tt1190634",
				images: [],
				monitored: true,
			},
		]);

		// Mock Plex search to return The Boys with matching TVDB ID
		searchPlexSpy.mockImplementation(async () => ({
			Metadata: [
				{
					title: "The Boys",
					year: 2019,
					guid: "tvdb://355567",
					thumb: "poster.jpg",
				},
			],
		}));

		const results = await searchSeriesTool.execute!(
			{ term: "The Boys" },
			{} as any,
		);

		expect(results[0].title).toBe("The Boys");
		expect(results[0].alreadyInPlex).toBe(true);
	});
});

describe("Timezone-aware formatEventTimestamp", () => {
	let getTimezoneSpy: any;

	beforeAll(() => {
		getTimezoneSpy = spyOn(db, "getTimezone");
	});

	afterAll(() => {
		getTimezoneSpy.mockRestore();
	});

	test("formatEventTimestamp should format date correctly with UTC timezone", () => {
		getTimezoneSpy.mockImplementation(() => "UTC");
		const { formatEventTimestamp } = require("../../services/database");

		const formatted = formatEventTimestamp("2026-07-04 12:00:00Z");
		expect(formatted).toBe("04/07/2026 12:00:00");
	});

	test("formatEventTimestamp should format date correctly with America/Buenos_Aires timezone", () => {
		getTimezoneSpy.mockImplementation(() => "America/Buenos_Aires");
		const { formatEventTimestamp } = require("../../services/database");

		// UTC 12:00:00 -> Buenos Aires (UTC-3) 09:00:00
		const formatted = formatEventTimestamp("2026-07-04T12:00:00.000Z");
		expect(formatted).toBe("04/07/2026 09:00:00");
	});
});
