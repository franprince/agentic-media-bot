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
});
