import { describe, expect, test, mock, beforeEach, beforeAll } from "bun:test";

beforeAll(() => {
    process.env.RADARR_URL = "http://localhost:7878";
    process.env.RADARR_API_KEY = "test_key";
});

import * as radarr from "../radarr";

describe("Radarr Service", () => {
    beforeEach(() => {
        // Clear all mocks before each test
        mock.restore();
    });

    test("searchMovie should fetch and return parsed json", async () => {
        const mockResponse = [
            { title: "The Matrix", year: 1999, tmdbId: 603, hasFile: false, monitored: false, overview: "Set in the 22nd century..." }
        ];

        global.fetch = mock(() =>
            Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
        ) as any;

        const result = await radarr.searchMovie("matrix");

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result).toBeArray();
        expect(result[0]?.title).toBe("The Matrix");
    });

    test("addMovie should perform POST and map correctly", async () => {
        const mockMovieListResponse: any[] = [];
        const mockAddResponse = {
            id: 10, title: "Inception", year: 2010, tmdbId: 27205
        };

        global.fetch = mock((input: any, init?: RequestInit) => {
            const url = String(input);
            const method = (init?.method || "GET").toUpperCase();

            if (url.includes("/movie") && method === "GET") {
                return Promise.resolve(new Response(JSON.stringify(mockMovieListResponse), { status: 200 }));
            }
            if (url.includes("/movie") && method === "POST") {
                return Promise.resolve(new Response(JSON.stringify(mockAddResponse), { status: 200 }));
            }
            return Promise.resolve(new Response("not found", { status: 404 }));
        }) as any;

        const result = await radarr.addMovie(27205, "Inception", 2010, "/movies", 1);

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(result.id).toBe(10);
        expect(result.title).toBe("Inception");
    });

    test("should throw an error on non-ok API responses", async () => {
        global.fetch = mock(() =>
            Promise.resolve(new Response(null, { status: 401, statusText: "Unauthorized" }))
        ) as any;

        expect(radarr.searchMovie("matrix")).rejects.toThrow("Radarr API Error: Unauthorized");
    });
});
