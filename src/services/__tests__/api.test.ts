import { describe, expect, test, mock, beforeEach, beforeAll } from "bun:test";
import { fetchService } from "../api";

describe("API Service", () => {
    beforeEach(() => {
        mock.restore();
    });

    test("fetchService should handle Radarr/Sonarr style apikey parameter", async () => {
        const mockResponse = { status: "ok" };
        global.fetch = mock((input: any) => {
            const url = new URL(input);
            expect(url.searchParams.get("apikey")).toBe("test_key");
            return Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }));
        }) as any;

        const result = await fetchService(
            "http://localhost:7878",
            "/api/v3/test",
            "apikey",
            "test_key"
        );

        expect(result).toEqual(mockResponse);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test("fetchService should handle Plex style X-Plex-Token header", async () => {
        const mockResponse = { status: "ok" };
        global.fetch = mock((input: any, init?: any) => {
            expect(init.headers["X-Plex-Token"]).toBe("test_token");
            return Promise.resolve(new Response(JSON.stringify(mockResponse), { status: 200 }));
        }) as any;

        const result = await fetchService(
            "http://localhost:32400",
            "/test",
            "X-Plex-Token",
            "test_token"
        );

        expect(result).toEqual(mockResponse);
    });

    test("fetchService should combine custom params", async () => {
        global.fetch = mock((input: any) => {
            const url = new URL(input);
            expect(url.searchParams.get("foo")).toBe("bar");
            expect(url.searchParams.get("apikey")).toBe("key");
            return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }));
        }) as any;

        await fetchService(
            "http://localhost",
            "/api",
            "apikey",
            "key",
            { params: { foo: "bar" } }
        );
    });

    test("fetchService should throw on non-ok response", async () => {
        global.fetch = mock(() =>
            Promise.resolve(new Response(null, { status: 404, statusText: "Not Found" }))
        ) as any;

        expect(fetchService("http://h", "/e", "k", "v"))
            .rejects.toThrow("API Error (/e): 404 Not Found");
    });
});
