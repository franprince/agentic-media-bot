import { describe, expect, test, beforeEach, beforeAll, afterAll, afterEach } from "bun:test";
import { http, HttpResponse } from "msw";
import { server } from "../../mocks/server";
import * as radarr from "../radarr";

beforeAll(() => {
    process.env.RADARR_URL = "http://localhost:7878";
    process.env.RADARR_API_KEY = "test_key";
    server.listen();
});

afterEach(() => {
    server.resetHandlers();
});

afterAll(() => {
    server.close();
});

describe("Radarr Service", () => {
    test("searchMovie should fetch and return parsed json", async () => {
        const result = await radarr.searchMovie("matrix");

        expect(result).toBeArray();
        expect(result[0]?.title).toBe("The Matrix");
    });

    test("addMovie should perform POST and map correctly", async () => {
        const result = await radarr.addMovie(27205, "Inception", 2010, "/movies", 1);

        expect(result.id).toBeGreaterThan(0);
        expect(result.title).toBe("Inception");
    });

    test("should throw an error on non-ok API responses", async () => {
        server.use(
            http.get("*/api/v3/movie/lookup", () => {
                return new HttpResponse(null, { status: 401, statusText: "Unauthorized" });
            })
        );

        await expect(radarr.searchMovie("matrix")).rejects.toThrow("HTTP 401: Unauthorized");
    });
});
