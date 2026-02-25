import { describe, expect, test, mock, beforeEach, beforeAll } from "bun:test";

beforeAll(() => {
    process.env.QBITTORRENT_URL = "http://localhost:8080";
    process.env.QBITTORRENT_USERNAME = "admin";
    process.env.QBITTORRENT_PASSWORD = "adminadmin";
});

import * as qbittorrent from "../qbittorrent";

describe("qBittorrent Service", () => {
    beforeEach(() => {
        mock.restore();
    });

    test("getTorrents should authenticate and fetch torrents", async () => {
        // Mock the sequence of calls: first login (returns set-cookie), then get torrents
        let callCount = 0;

        global.fetch = mock(async (url: string | URL | Request) => {
            const urlStr = url.toString();
            if (urlStr.includes("/auth/login")) {
                const headers = new Headers();
                headers.set("set-cookie", "SID=supersidsession123; HttpOnly");
                return new Response(null, { status: 200, headers });
            }
            if (urlStr.includes("/torrents/info")) {
                const mockResponse = [
                    { name: "Ubuntu Linux", hash: "abcdef12345", state: "downloading", progress: 0.5 }
                ];
                const headers = new Headers();
                headers.set("content-type", "application/json");
                return new Response(JSON.stringify(mockResponse), { status: 200, headers });
            }
            return new Response(null, { status: 404 });
        }) as any;

        const result = await qbittorrent.getTorrents();

        // 1 for auth, 1 for the actual request
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect(result).toBeArray();
        expect(result[0]?.name).toBe("Ubuntu Linux");
    });
});
