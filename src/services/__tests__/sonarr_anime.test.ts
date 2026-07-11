import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { addSeriesTool } from "../../agent/tools";
import * as sonarr from "../sonarr";

describe("Sonarr Anime Support", () => {
	const spies: any[] = [];

	afterEach(() => {
		while (spies.length > 0) {
			const s = spies.pop();
			if (s && s.mockRestore) s.mockRestore();
		}
	});

	test("addSeriesTool should detect anime and pass seriesType: anime", async () => {
		const tvdbId = 348545; // Demon Slayer
		const title = "Demon Slayer: Kimetsu no Yaiba";

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
						title,
						tvdbId,
						year: 2019,
						genres: ["Action", "Adventure", "Animation", "Anime", "Fantasy"],
						seasons: [{ seasonNumber: 1, monitored: true }],
					}) as any,
			),
		);

		const addSpy = spyOn(sonarr, "addSeries").mockImplementation(
			async () => ({ title }) as any,
		);
		spies.push(addSpy);

		const result = (await addSeriesTool.execute(
			{
				tvdbId,
				title,
				confirm: true,
				qualityProfileId: 1,
				rootFolderPath: "/tv",
			},
			{} as any,
		)) as any;

		expect(result.success).toBe(true);
		expect(result.message).toContain("as anime series");
		expect(addSpy).toHaveBeenCalled();

		const lastCallArgs = addSpy.mock.calls[0];
		if (!lastCallArgs) throw new Error("addSeries was not called");
		expect(lastCallArgs[6]).toBe("anime");
	});

	test("addSeriesTool should treat standard series as standard", async () => {
		const tvdbId = 76203; // Curb Your Enthusiasm
		const title = "Curb Your Enthusiasm";

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
						title,
						tvdbId,
						year: 2000,
						genres: ["Comedy"],
						seasons: [{ seasonNumber: 1, monitored: true }],
					}) as any,
			),
		);

		const addSpy = spyOn(sonarr, "addSeries").mockImplementation(
			async () => ({ title }) as any,
		);
		spies.push(addSpy);

		const result = (await addSeriesTool.execute(
			{
				tvdbId,
				title,
				confirm: true,
			},
			{} as any,
		)) as any;

		expect(result.success).toBe(true);
		expect(result.message).toContain("as standard series");
		expect(addSpy).toHaveBeenCalled();

		const lastCallArgs = addSpy.mock.calls[0];
		if (!lastCallArgs) throw new Error("addSeries was not called");
		expect(lastCallArgs[6]).toBe("standard");
	});
});
