import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { HttpResponse, http } from "msw";
import { server } from "../../mocks/server";
import * as sonarr from "../sonarr";

beforeAll(() => {
	process.env.SONARR_URL = "http://localhost:8989";
	process.env.SONARR_API_KEY = "test_key";
	server.listen();
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});

describe("Sonarr Service", () => {
	test("searchSeries should fetch and return parsed json", async () => {
		const result = await sonarr.searchSeries("breaking bad");

		expect(result).toBeArray();
		expect(result[0]?.title).toBe("Breaking Bad");
	});

	test("addSeries should perform POST and map correctly", async () => {
		const result = await sonarr.addSeries(73244, "The Office", 1, 1, "/tv", [
			{ seasonNumber: 1, monitored: true },
		]);

		expect(result.id).toBeGreaterThan(0);
		expect(result.title).toBe("The Office");
	});

	test("should throw an error on non-ok API responses", async () => {
		server.use(
			http.get("*/api/v3/series/lookup", () => {
				return new HttpResponse(null, {
					status: 401,
					statusText: "Unauthorized",
				});
			}),
		);

		await expect(sonarr.searchSeries("breaking bad")).rejects.toThrow(
			"HTTP 401: Unauthorized",
		);
	});
});
