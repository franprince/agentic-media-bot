import { describe, expect, test, beforeEach, beforeAll, afterAll, afterEach } from "bun:test";
import { server } from "../../mocks/server";
import * as plex from "../plex";

beforeAll(() => {
    process.env.PLEX_URL = "http://localhost:32400";
    process.env.PLEX_TOKEN = "test_token";
    server.listen();
});

afterEach(() => {
    server.resetHandlers();
});

afterAll(() => {
    server.close();
});

describe("Plex Service", () => {
    test("searchPlex should return search results from MediaContainer", async () => {
        const result = await plex.searchPlex("avatar");

        expect(result.Metadata?.[0]?.title).toBe("Avatar");
    });

    test("getItemsByCountry should match demonyms like 'Argentine' to 'Argentina'", async () => {
        const result = await plex.getItemsByCountry("1", "Argentine");

        expect(result.Metadata?.[0]?.title).toBe("Nueve Reinas");
    });

    test("getItemsByCountry should handle Spanish variants like 'argentinas'", async () => {
        const result = await plex.getItemsByCountry("2", "argentinas");

        expect(result.Metadata?.[0]?.title).toBe("Relatos salvajes");
    });

    test("getItemsByCountry should parse country key when Plex returns a full filter path", async () => {
        const result = await plex.getItemsByCountry("3", "German");

        expect(result.Metadata?.[0]?.title).toBe("Das Boot");
    });

    test("normalizeCountryName should convert demonyms to country nouns", () => {
        expect(plex.normalizeCountryName("German")).toBe("germany");
        expect(plex.normalizeCountryName("Danish")).toBe("denmark");
        expect(plex.normalizeCountryName("Argentine")).toBe("argentina");
        expect(plex.normalizeCountryName("France")).toBe("france");
    });

    test("filterItemsByCountryTag should include only matching country tags", async () => {
        const items = [
            { ratingKey: "1", title: "German Film" },
            { ratingKey: "2", title: "Non German Film" },
        ];

        const filtered = await plex.filterItemsByCountryTag(items, "Germany");
        expect(filtered.length).toBe(1);
        expect(filtered[0]?.ratingKey).toBe("1");
    });

    test("filterItemsByCountryTag should enforce primary country by default", async () => {
        const items = [
            { ratingKey: "11", title: "Co-production" },
        ];

        const defaultFiltered = await plex.filterItemsByCountryTag(items, "France");
        const nonPrimaryFiltered = await plex.filterItemsByCountryTag(items, "France", { primaryOnly: false });

        expect(defaultFiltered.length).toBe(0);
        expect(nonPrimaryFiltered.length).toBe(1);
    });

    test("getItemCountryTags should return normalized country tags", async () => {
        const tags = await plex.getItemCountryTags("44");
        expect(tags).toEqual(["germany", "france"]);
    });
});
