import { describe, expect, test, mock, beforeEach, beforeAll } from "bun:test";

beforeAll(() => {
    process.env.SONARR_URL = "http://localhost:8989";
    process.env.SONARR_API_KEY = "test_key";
});

import * as sonarr from "../sonarr";

describe("Sonarr Service", () => {
    beforeEach(() => {
        mock.restore();
    });

    test("searchSeries should fetch and return parsed json", async () => {
        const mockResponse = [
            { title: "Breaking Bad", tvdbId: 81189, seasons: [] }
        ];

        global.fetch = mock(() =>
            Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }))
        ) as any;

        const result = await sonarr.searchSeries("breaking bad");

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(result).toBeArray();
        expect(result[0]?.title).toBe("Breaking Bad");
    });

    test("addSeries should perform POST and map correctly", async () => {
        const mockSeriesListResponse: any[] = [];
        const mockAddResponse = {
            id: 15, title: "The Office", tvdbId: 73244
        };

        global.fetch = mock((input: any, init?: RequestInit) => {
            const url = String(input);
            const method = (init?.method || "GET").toUpperCase();

            if (url.includes("/series") && method === "GET") {
                return Promise.resolve(new Response(JSON.stringify(mockSeriesListResponse), { status: 200 }));
            }
            if (url.includes("/series") && method === "POST") {
                return Promise.resolve(new Response(JSON.stringify(mockAddResponse), { status: 200 }));
            }
            return Promise.resolve(new Response("not found", { status: 404 }));
        }) as any;

        const result = await sonarr.addSeries(73244, "The Office", 1, 1, "/tv", [{ seasonNumber: 1, monitored: true }]);

        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(result.id).toBe(15);
        expect(result.title).toBe("The Office");
    });

    test("should throw an error on non-ok API responses", async () => {
        global.fetch = mock(() =>
            Promise.resolve(new Response(null, { status: 401, statusText: "Unauthorized" }))
        ) as any;

        expect(sonarr.searchSeries("breaking bad")).rejects.toThrow("API Error (/api/v3/series/lookup): 401 Unauthorized");
    });
});
