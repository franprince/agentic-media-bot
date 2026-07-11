import { beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as radarr from "../../services/radarr";
import * as sonarr from "../../services/sonarr";
import { addMovieTool, addSeriesTool, clearCache } from "../tools";

describe("IMDb Validation", () => {
	beforeEach(() => {
		// Clear config cache to prevent test-to-test pollution
		clearCache();
		// Mock profiles and folders
		spyOn(radarr, "getQualityProfiles").mockImplementation(async () => [
			{ id: 1, name: "HD" },
		]);
		spyOn(radarr, "getRootFolders").mockImplementation(async () => [
			{ id: 1, path: "/movies", freeSpace: 1000 },
		]);
		spyOn(sonarr, "getQualityProfiles").mockImplementation(async () => [
			{ id: 1, name: "HD" },
		]);
		spyOn(sonarr, "getLanguageProfiles").mockImplementation(async () => [
			{ id: 1, name: "English" },
		]);
		spyOn(sonarr, "getRootFolders").mockImplementation(async () => [
			{ id: 1, path: "/tv", freeSpace: 1000 },
		]);
	});

	describe("addMovieTool", () => {
		test("should prioritize IMDb ID and detect title mismatch", async () => {
			const radarrSearchSpy = spyOn(radarr, "searchMovie").mockImplementation(
				async (term) => {
					if (term === "tt0111161" || term === "Inception") {
						return [
							{
								title: "The Shawshank Redemption",
								tmdbId: 278,
								year: 1994,
								genres: ["Drama"],
								overview: "Overview...",
								images: [{ coverType: "poster", url: "/poster.jpg" }],
							},
						] as any;
					}
					return [];
				},
			);

			const result = await addMovieTool.execute(
				{
					title: "Inception",
					year: 2010,
					tmdbId: 27205,
					imdbId: "tt0111161",
					confirm: false,
				},
				{ abortSignal: undefined as any },
			);

			expect(radarrSearchSpy).toHaveBeenCalledWith("tt0111161");
			expect(result.confirmationRequired).toBe(true);
			expect(result.message).toContain("Title Mismatch");
			expect(result.message).toContain("The Shawshank Redemption");
			expect(result.mediaDetails.tmdbId).toBe(278);
		});

		test("should proceed normally if titles match", async () => {
			spyOn(radarr, "searchMovie").mockImplementation(
				async () =>
					[
						{
							title: "Inception",
							tmdbId: 27205,
							year: 2010,
							genres: ["Action"],
							overview: "Overview...",
							images: [],
						},
					] as any,
			);

			const result = await addMovieTool.execute(
				{
					title: "Inception",
					year: 2010,
					tmdbId: 27205,
					imdbId: "tt1375666",
					confirm: false,
				},
				{ abortSignal: undefined as any },
			);

			expect(result.confirmationRequired).toBe(true);
			expect(result.message).not.toContain("Title Mismatch");
			expect(result.message).toContain("Inception");
		});

		test("should default to Full-HD or Better profile if available", async () => {
			spyOn(radarr, "getQualityProfiles").mockImplementation(async () => [
				{ id: 1, name: "Any" },
				{ id: 7, name: "Full-HD or Better (NO REMUX)" },
			]);
			spyOn(radarr, "searchMovie").mockImplementation(
				async () =>
					[
						{
							title: "Inception",
							tmdbId: 27205,
							year: 2010,
							genres: ["Action"],
							overview: "Overview...",
							images: [],
						},
					] as any,
			);

			const result = await addMovieTool.execute(
				{
					title: "Inception",
					year: 2010,
					tmdbId: 27205,
					imdbId: "tt1375666",
					confirm: false,
				},
				{ abortSignal: undefined as any },
			);

			expect(result.confirmationRequired).toBe(true);
			const addBtn = result.buttons?.find((b: any) => b.text.includes("Yes"));
			expect(addBtn?.data).toBe("add movie 27205 7");

			const addMovieSpy = spyOn(radarr, "addMovie").mockImplementation(
				async () => ({ title: "Inception" }) as any,
			);
			const confirmResult = await addMovieTool.execute(
				{
					title: "Inception",
					year: 2010,
					tmdbId: 27205,
					imdbId: "tt1375666",
					confirm: true,
				},
				{ abortSignal: undefined as any },
			);

			expect(addMovieSpy).toHaveBeenCalledWith(
				27205,
				"Inception",
				2010,
				"/movies",
				7,
				undefined,
			);
			expect(confirmResult.success).toBe(true);
		});
	});

	describe("addSeriesTool", () => {
		test("should prioritize IMDb ID and detect title mismatch", async () => {
			const sonarrSearchSpy = spyOn(sonarr, "searchSeries").mockImplementation(
				async (term) => {
					if (term === "tt0903747") {
						return [
							{
								title: "Breaking Bad",
								tvdbId: 81189,
								year: 2008,
								genres: ["Drama"],
								overview: "Overview...",
								images: [],
								seasons: [1, 2, 3, 4, 5],
							},
						] as any;
					}
					return [];
				},
			);

			// Mock getSeriesByTvdbId for the later part of the tool
			spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(
				async () =>
					({
						title: "Breaking Bad",
						tvdbId: 81189,
						year: 2008,
						overview: "Overview...",
						images: [],
						seasons: [{ seasonNumber: 1, monitored: true }],
					}) as any,
			);

			const result = await addSeriesTool.execute(
				{
					title: "The Boys",
					tvdbId: 355567,
					imdbId: "tt0903747",
					confirm: false,
				},
				{ abortSignal: undefined as any },
			);

			expect(sonarrSearchSpy).toHaveBeenCalledWith("tt0903747");
			expect(result.confirmationRequired).toBe(true);
			expect(result.message).toContain("Title Mismatch");
			expect(result.message).toContain("Breaking Bad");
			expect(result.mediaDetails.tvdbId).toBe(81189);
		});

		test("should default to Full HD or Better profile and Original language profile if available", async () => {
			spyOn(sonarr, "getQualityProfiles").mockImplementation(async () => [
				{ id: 1, name: "Any" },
				{ id: 7, name: "Full HD or Better" },
			]);
			spyOn(sonarr, "getLanguageProfiles").mockImplementation(async () => [
				{ id: 1, name: "English" },
				{ id: 2, name: "Original Language" },
			]);
			spyOn(sonarr, "searchSeries").mockImplementation(
				async () =>
					[
						{
							title: "Breaking Bad",
							tvdbId: 81189,
							year: 2008,
							genres: ["Drama"],
							overview: "Overview...",
							images: [],
							seasons: [1],
						},
					] as any,
			);
			spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(
				async () =>
					({
						title: "Breaking Bad",
						tvdbId: 81189,
						year: 2008,
						overview: "Overview...",
						images: [],
						seasons: [{ seasonNumber: 1, monitored: true }],
					}) as any,
			);

			const result = await addSeriesTool.execute(
				{
					title: "Breaking Bad",
					tvdbId: 81189,
					imdbId: "tt0903747",
					confirm: false,
				},
				{ abortSignal: undefined as any },
			);

			expect(result.confirmationRequired).toBe(true);
			const addBtn = result.buttons?.find((b: any) => b.text.includes("Yes"));
			expect(addBtn?.data).toBe("add series 81189 7");

			const addSeriesSpy = spyOn(sonarr, "addSeries").mockImplementation(
				async () => ({ title: "Breaking Bad" }) as any,
			);
			const confirmResult = await addSeriesTool.execute(
				{
					title: "Breaking Bad",
					tvdbId: 81189,
					imdbId: "tt0903747",
					confirm: true,
				},
				{ abortSignal: undefined as any },
			);

			expect(addSeriesSpy).toHaveBeenCalledWith(
				81189,
				"Breaking Bad",
				7,
				2,
				"/tv",
				[{ seasonNumber: 1, monitored: true }],
				"standard",
				undefined,
			);
			expect(confirmResult.success).toBe(true);
		});
	});
});
