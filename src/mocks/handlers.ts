import { http, HttpResponse } from "msw";

export const handlers = [
    // Sonarr Handlers
    http.get("*/api/v3/series/lookup", ({ request }) => {
        const url = new URL(request.url);
        const term = url.searchParams.get("term");

        if (term?.toLowerCase() === "breaking bad") {
            return HttpResponse.json([
                { title: "Breaking Bad", tvdbId: 81189, seasons: [] }
            ]);
        }
        return HttpResponse.json([]);
    }),

    http.get("*/api/v3/series", () => {
        return HttpResponse.json([]);
    }),

    http.post("*/api/v3/series", async ({ request }) => {
        const body = await request.json() as any;
        return HttpResponse.json({
            id: 15,
            ...body
        });
    }),

    // Radarr Handlers
    http.get("*/api/v3/movie/lookup", ({ request }) => {
        const url = new URL(request.url);
        const term = url.searchParams.get("term");

        if (term?.toLowerCase() === "inception") {
            return HttpResponse.json([
                { title: "Inception", tmdbId: 27205, year: 2010 }
            ]);
        }
        if (term?.toLowerCase() === "matrix") {
            return HttpResponse.json([
                { title: "The Matrix", year: 1999, tmdbId: 603, hasFile: false, monitored: false, overview: "Set in the 22nd century..." }
            ]);
        }
        return HttpResponse.json([]);
    }),

    http.get("*/api/v3/movie", () => {
        return HttpResponse.json([]);
    }),

    http.post("*/api/v3/movie", async ({ request }) => {
        const body = await request.json() as any;
        return HttpResponse.json({
            id: 20,
            ...body
        });
    }),

    // System Status
    http.get("*/api/v3/system/status", () => {
        return HttpResponse.json({ version: "3.0.0" });
    }),

    // qBittorrent Handlers
    http.post("*/api/v2/auth/login", () => {
        return new HttpResponse(null, {
            status: 200,
            headers: {
                "set-cookie": "SID=supersidsession123; HttpOnly"
            }
        });
    }),

    http.get("*/api/v2/torrents/info", () => {
        return HttpResponse.json([
            { name: "Ubuntu Linux", hash: "abcdef12345", state: "downloading", progress: 0.5 }
        ]);
    }),

    // Plex Handlers
    http.get("*/search", () => {
        return HttpResponse.json({
            MediaContainer: {
                size: 1,
                Metadata: [{ title: "Avatar", type: "movie" }]
            }
        });
    }),

    http.get("*/library/sections/:sectionId/country", ({ params }) => {
        const { sectionId } = params;
        let directory: any[] = [];

        if (sectionId === "1") {
            directory = [{ title: "Argentina", key: "42" }];
        } else if (sectionId === "2") {
            directory = [{ title: "Argentina", key: "7" }];
        } else if (sectionId === "3") {
            directory = [{ title: "Germany", key: "/library/sections/3/all?type=1&country=99" }];
        }

        return HttpResponse.json({
            MediaContainer: {
                Directory: directory,
            },
        });
    }),

    http.get("*/library/sections/:sectionId/all", ({ request, params }) => {
        const url = new URL(request.url);
        const country = url.searchParams.get("country");
        const { sectionId } = params;

        let metadata: any[] = [];
        if (sectionId === "1" && country === "42") {
            metadata = [{ title: "Nueve Reinas", type: "movie" }];
        } else if (sectionId === "2" && country === "7") {
            metadata = [{ title: "Relatos salvajes", type: "movie" }];
        } else if (sectionId === "3" && country === "99") {
            metadata = [{ title: "Das Boot", type: "movie" }];
        }

        return HttpResponse.json({
            MediaContainer: {
                size: metadata.length,
                Metadata: metadata,
            },
        });
    }),

    http.get("*/library/metadata/:ratingKey", ({ params }) => {
        const { ratingKey } = params;

        let country: any[] = [];
        if (ratingKey === "1") country = [{ tag: "Germany" }];
        if (ratingKey === "2") country = [{ tag: "France" }];
        if (ratingKey === "11") country = [{ tag: "United States" }, { tag: "France" }];
        if (ratingKey === "44") country = [{ tag: "German" }, { tag: "France" }];

        return HttpResponse.json({
            MediaContainer: {
                Metadata: [{ Country: country }],
            },
        });
    }),
];
