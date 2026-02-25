import { describe, expect, test, mock, beforeEach, beforeAll } from "bun:test";

beforeAll(() => {
    process.env.PLEX_URL = "http://localhost:32400";
    process.env.PLEX_TOKEN = "test_token";
});

import * as plex from "../plex";

describe("Plex Service", () => {
    beforeEach(() => {
        mock.restore();
    });

    test("searchPlex should return search results from MediaContainer", async () => {
        const mockResponse = {
            MediaContainer: {
                size: 1,
                Metadata: [
                    { title: "Avatar", type: "movie" }
                ]
            }
        };

        global.fetch = mock(() =>
            Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
        ) as any;

        const result = await plex.searchPlex("avatar");

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result.Metadata?.[0]?.title).toBe("Avatar");
    });

    test("getItemsByCountry should match demonyms like 'Argentine' to 'Argentina'", async () => {
        const sectionId = "1";
        const countriesResponse = {
            MediaContainer: {
                Directory: [{ title: "Argentina", key: "42" }],
            },
        };
        const itemsResponse = {
            MediaContainer: {
                size: 1,
                Metadata: [{ title: "Nueve Reinas", type: "movie" }],
            },
        };

        global.fetch = mock((input: any) => {
            const url = String(input);
            if (url.includes(`/library/sections/${sectionId}/country`)) {
                return Promise.resolve(new Response(JSON.stringify(countriesResponse), { status: 200 }));
            }
            if (url.includes(`/library/sections/${sectionId}/all`) && url.includes("country=42")) {
                return Promise.resolve(new Response(JSON.stringify(itemsResponse), { status: 200 }));
            }
            return Promise.resolve(new Response("not found", { status: 404 }));
        }) as any;

        const result = await plex.getItemsByCountry(sectionId, "Argentine");

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(result.Metadata?.[0]?.title).toBe("Nueve Reinas");
    });

    test("getItemsByCountry should handle Spanish variants like 'argentinas'", async () => {
        const sectionId = "2";
        const countriesResponse = {
            MediaContainer: {
                Directory: [{ title: "Argentina", key: "7" }],
            },
        };
        const itemsResponse = {
            MediaContainer: {
                size: 1,
                Metadata: [{ title: "Relatos salvajes", type: "movie" }],
            },
        };

        global.fetch = mock((input: any) => {
            const url = String(input);
            if (url.includes(`/library/sections/${sectionId}/country`)) {
                return Promise.resolve(new Response(JSON.stringify(countriesResponse), { status: 200 }));
            }
            if (url.includes(`/library/sections/${sectionId}/all`) && url.includes("country=7")) {
                return Promise.resolve(new Response(JSON.stringify(itemsResponse), { status: 200 }));
            }
            return Promise.resolve(new Response("not found", { status: 404 }));
        }) as any;

        const result = await plex.getItemsByCountry(sectionId, "argentinas");

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(result.Metadata?.[0]?.title).toBe("Relatos salvajes");
    });

    test("getItemsByCountry should parse country key when Plex returns a full filter path", async () => {
        const sectionId = "3";
        const countriesResponse = {
            MediaContainer: {
                Directory: [{ title: "Germany", key: `/library/sections/${sectionId}/all?type=1&country=99` }],
            },
        };
        const itemsResponse = {
            MediaContainer: {
                size: 1,
                Metadata: [{ title: "Das Boot", type: "movie" }],
            },
        };

        global.fetch = mock((input: any) => {
            const url = String(input);
            if (url.includes(`/library/sections/${sectionId}/country`)) {
                return Promise.resolve(new Response(JSON.stringify(countriesResponse), { status: 200 }));
            }
            if (url.includes(`/library/sections/${sectionId}/all`) && url.includes("country=99") && url.includes("type=1")) {
                return Promise.resolve(new Response(JSON.stringify(itemsResponse), { status: 200 }));
            }
            return Promise.resolve(new Response("not found", { status: 404 }));
        }) as any;

        const result = await plex.getItemsByCountry(sectionId, "German");

        expect(global.fetch).toHaveBeenCalledTimes(2);
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

        global.fetch = mock((input: any) => {
            const url = String(input);
            if (url.includes("/library/metadata/1")) {
                return Promise.resolve(new Response(JSON.stringify({
                    MediaContainer: {
                        Metadata: [{ Country: [{ tag: "Germany" }] }],
                    },
                }), { status: 200 }));
            }
            if (url.includes("/library/metadata/2")) {
                return Promise.resolve(new Response(JSON.stringify({
                    MediaContainer: {
                        Metadata: [{ Country: [{ tag: "France" }] }],
                    },
                }), { status: 200 }));
            }
            return Promise.resolve(new Response("not found", { status: 404 }));
        }) as any;

        const filtered = await plex.filterItemsByCountryTag(items, "Germany");
        expect(filtered.length).toBe(1);
        expect(filtered[0]?.ratingKey).toBe("1");
    });

    test("getItemCountryTags should return normalized country tags", async () => {
        global.fetch = mock((input: any) => {
            const url = String(input);
            if (url.includes("/library/metadata/44")) {
                return Promise.resolve(new Response(JSON.stringify({
                    MediaContainer: {
                        Metadata: [{ Country: [{ tag: "German" }, { tag: "France" }] }],
                    },
                }), { status: 200 }));
            }
            return Promise.resolve(new Response("not found", { status: 404 }));
        }) as any;

        const tags = await plex.getItemCountryTags("44");
        expect(tags).toEqual(["germany", "france"]);
    });
});
