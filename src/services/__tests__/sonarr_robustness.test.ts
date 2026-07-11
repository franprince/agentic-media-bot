import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { addSeriesTool } from "../../agent/tools";
import * as sonarr from "../sonarr";

describe("Sonarr Add Series Robustness", () => {
	const spies: any[] = [];

	beforeEach(() => {
		// Clear cache-like behavior if any
	});

	afterEach(() => {
		while (spies.length > 0) {
			const s = spies.pop();
			if (s && s.mockRestore) s.mockRestore();
		}
	});

	test("addSeriesTool should succeed using TVDB ID even if title search is ambiguous", async () => {
		const tvdbId = 76156; // Scrubs
		const title = "Scrubs";

		spies.push(
			spyOn(sonarr, "getQualityProfiles").mockImplementation(async () => [
				{ id: 1, name: "Any" },
			]),
		);
		spies.push(
			spyOn(sonarr, "getLanguageProfiles").mockImplementation(async () => [
				{ id: 1, name: "English" },
			]),
		);
		spies.push(
			spyOn(sonarr, "getRootFolders").mockImplementation(async () => [
				{ id: 1, path: "/tv", freeSpace: 1000000 },
			]),
		);

		const getByIdSpy = spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(
			async (id) => {
				if (id === tvdbId) {
					return {
						title: "Scrubs",
						tvdbId: 76156,
						year: 2001,
						seasons: [{ seasonNumber: 1, monitored: true }],
					} as any;
				}
				return undefined;
			},
		);
		spies.push(getByIdSpy);

		const addSpy = spyOn(sonarr, "addSeries").mockImplementation(
			async () => ({}) as any,
		);
		spies.push(addSpy);

		const result = await addSeriesTool.execute(
			{ tvdbId, title, confirm: true },
			{} as any,
		);

		expect(result.success).toBe(true);
		expect(getByIdSpy).toHaveBeenCalledWith(tvdbId);
		expect(addSpy).toHaveBeenCalled();
	});

	test("addSeriesTool should fallback to title search if TVDB ID lookup fails", async () => {
		const tvdbId = 76156;
		const title = "Scrubs";

		spies.push(
			spyOn(sonarr, "getQualityProfiles").mockImplementation(async () => [
				{ id: 1, name: "Any" },
			]),
		);
		spies.push(
			spyOn(sonarr, "getLanguageProfiles").mockImplementation(async () => [
				{ id: 1, name: "English" },
			]),
		);
		spies.push(
			spyOn(sonarr, "getRootFolders").mockImplementation(async () => [
				{ id: 1, path: "/tv", freeSpace: 1000000 },
			]),
		);
		spies.push(
			spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(
				async () => undefined,
			),
		);

		const searchSpy = spyOn(sonarr, "searchSeries").mockImplementation(
			async (term) => {
				if (term === title) {
					return [
						{
							title: "Scrubs",
							tvdbId: 76156,
							year: 2001,
							seasons: [{ seasonNumber: 1, monitored: true }],
						},
					] as any;
				}
				return [];
			},
		);
		spies.push(searchSpy);

		const addSpy = spyOn(sonarr, "addSeries").mockImplementation(
			async () => ({}) as any,
		);
		spies.push(addSpy);

		const result = await addSeriesTool.execute(
			{ tvdbId, title, confirm: true },
			{} as any,
		);

		expect(result.success).toBe(true);
		expect(searchSpy).toHaveBeenCalledWith(title);
	});

	test("addSeriesTool should return confirmationRequired when confirm is false", async () => {
		const tvdbId = 76156;
		const title = "Scrubs";

		spies.push(
			spyOn(sonarr, "getQualityProfiles").mockImplementation(async () => [
				{ id: 1, name: "Any" },
			]),
		);
		spies.push(
			spyOn(sonarr, "getLanguageProfiles").mockImplementation(async () => [
				{ id: 1, name: "English" },
			]),
		);
		spies.push(
			spyOn(sonarr, "getRootFolders").mockImplementation(async () => [
				{ id: 1, path: "/tv", freeSpace: 1000000 },
			]),
		);
		spies.push(
			spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(
				async () =>
					({
						title: "Scrubs",
						tvdbId: 76156,
						year: 2001,
						seasons: [1],
					}) as any,
			),
		);

		const result = await addSeriesTool.execute(
			{ tvdbId, title, confirm: false },
			{} as any,
		);

		expect(result.confirmationRequired).toBe(true);
		expect(result.mediaDetails.title).toBe("Scrubs");
	});
});
