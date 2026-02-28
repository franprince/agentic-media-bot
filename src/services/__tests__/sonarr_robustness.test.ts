import { expect, test, describe, spyOn, beforeEach } from "bun:test";
import * as sonarr from "../sonarr";
import { addSeriesTool } from "../../agent/tools";

describe("Sonarr Add Series Robustness", () => {
    beforeEach(() => {
        // Clear cache-like behavior if any
    });

    test("addSeriesTool should succeed using TVDB ID even if title search is ambiguous", async () => {
        const tvdbId = 76156; // Scrubs
        const title = "Scrubs";

        // Mock quality profiles
        spyOn(sonarr, "getQualityProfiles").mockImplementation(async () => [
            { id: 1, name: "Any" }
        ]);

        // Mock language profiles
        spyOn(sonarr, "getLanguageProfiles").mockImplementation(async () => [
            { id: 1, name: "English" }
        ]);

        // Mock root folders
        spyOn(sonarr, "getRootFolders").mockImplementation(async () => [
            { id: 1, path: "/tv", freeSpace: 1000000 }
        ]);

        // Mock getSeriesByTvdbId to return the correct series
        const getByIdSpy = spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(async (id) => {
            if (id === tvdbId) {
                return {
                    title: "Scrubs",
                    tvdbId: 76156,
                    year: 2001,
                    seasons: [{ seasonNumber: 1, monitored: true }]
                } as any;
            }
            return undefined;
        });

        // Mock addSeries to succeed
        const addSpy = spyOn(sonarr, "addSeries").mockImplementation(async () => ({}) as any);

        const result = await addSeriesTool.execute({ tvdbId, title, confirm: true }, {} as any);

        expect(result.success).toBe(true);
        expect(getByIdSpy).toHaveBeenCalledWith(tvdbId);
        expect(addSpy).toHaveBeenCalled();
    });

    test("addSeriesTool should fallback to title search if TVDB ID lookup fails", async () => {
        const tvdbId = 76156;
        const title = "Scrubs";

        spyOn(sonarr, "getQualityProfiles").mockImplementation(async () => [{ id: 1, name: "Any" }]);
        spyOn(sonarr, "getLanguageProfiles").mockImplementation(async () => [{ id: 1, name: "English" }]);
        spyOn(sonarr, "getRootFolders").mockImplementation(async () => [{ id: 1, path: "/tv", freeSpace: 1000000 }]);

        // ID lookup fails
        spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(async () => undefined);

        // Title search succeeds and finds the ID
        const searchSpy = spyOn(sonarr, "searchSeries").mockImplementation(async (term) => {
            if (term === title) {
                return [{
                    title: "Scrubs",
                    tvdbId: 76156,
                    year: 2001,
                    seasons: [{ seasonNumber: 1, monitored: true }]
                }] as any;
            }
            return [];
        });

        spyOn(sonarr, "addSeries").mockImplementation(async () => ({}) as any);

        const result = await addSeriesTool.execute({ tvdbId, title, confirm: true }, {} as any);

        expect(result.success).toBe(true);
        expect(searchSpy).toHaveBeenCalledWith(title);
    });

    test("addSeriesTool should return confirmationRequired when confirm is false", async () => {
        const tvdbId = 76156;
        const title = "Scrubs";

        spyOn(sonarr, "getQualityProfiles").mockImplementation(async () => [{ id: 1, name: "Any" }]);
        spyOn(sonarr, "getLanguageProfiles").mockImplementation(async () => [{ id: 1, name: "English" }]);
        spyOn(sonarr, "getRootFolders").mockImplementation(async () => [{ id: 1, path: "/tv", freeSpace: 1000000 }]);

        spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(async () => ({
            title: "Scrubs",
            tvdbId: 76156,
            year: 2001,
            seasons: [1]
        } as any));

        const result = await addSeriesTool.execute({ tvdbId, title, confirm: false }, {} as any);

        expect(result.confirmationRequired).toBe(true);
        expect(result.mediaDetails.title).toBe("Scrubs");
    });
});
