import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { removeMovieTool } from "../../agent/tools";
import * as radarr from "../radarr";

describe("Radarr Remove Movie", () => {
	const spies: any[] = [];

	afterEach(() => {
		while (spies.length > 0) {
			const s = spies.pop();
			if (s && s.mockRestore) s.mockRestore();
		}
	});

	test("should fail if movie is not found by tmdbId", async () => {
		spies.push(spyOn(radarr, "searchMovie").mockImplementation(async () => []));

		const result = (await removeMovieTool.execute(
			{
				tmdbId: 99999,
				deleteFiles: false,
				confirm: false,
			},
			{} as any,
		)) as any;

		expect(result.message).toContain("Could not find a movie");
	});

	test("should call deleteMovie with correct arguments", async () => {
		spies.push(
			spyOn(radarr, "searchMovie").mockImplementation(async () => [
				{
					id: 20,
					title: "Test Movie",
					tmdbId: 12345,
				} as any,
			]),
		);

		const deleteSpy = spyOn(radarr, "deleteMovie").mockImplementation(
			async () => {},
		);
		spies.push(deleteSpy);

		const result = (await removeMovieTool.execute(
			{
				tmdbId: 12345,
				deleteFiles: true,
				confirm: true,
			},
			{} as any,
		)) as any;

		expect(result.success).toBe(true);
		expect(result.message).toContain("Successfully removed");
		expect(deleteSpy).toHaveBeenCalledWith(20, true);
	});
});
