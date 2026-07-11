import { afterEach, describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { server } from "../../mocks/server";
import { fetchService } from "../api";

afterEach(() => {
	server.resetHandlers();
});

describe("API Service", () => {
	test("fetchService should handle Radarr/Sonarr style apikey parameter", async () => {
		let capturedUrl: URL | undefined;

		server.use(
			http.get("http://localhost:7878/api/v3/test", ({ request }) => {
				capturedUrl = new URL(request.url);
				return HttpResponse.json({ status: "ok" });
			}),
		);

		const result = await fetchService(
			"http://localhost:7878",
			"/api/v3/test",
			"apikey",
			"test_key",
		);

		expect(result).toEqual({ status: "ok" });
		expect(capturedUrl?.searchParams.get("apikey")).toBe("test_key");
	});

	test("fetchService should handle Plex style X-Plex-Token header", async () => {
		let capturedHeader: string | null | undefined;

		server.use(
			http.get("http://localhost:32400/test", ({ request }) => {
				capturedHeader = request.headers.get("X-Plex-Token");
				return HttpResponse.json({ status: "ok" });
			}),
		);

		const result = await fetchService(
			"http://localhost:32400",
			"/test",
			"X-Plex-Token",
			"test_token",
		);

		expect(result).toEqual({ status: "ok" });
		expect(capturedHeader).toBe("test_token");
	});

	test("fetchService should combine custom params", async () => {
		let capturedUrl: URL | undefined;

		server.use(
			http.get("http://localhost/api", ({ request }) => {
				capturedUrl = new URL(request.url);
				return HttpResponse.json({});
			}),
		);

		await fetchService("http://localhost", "/api", "apikey", "key", {
			params: { foo: "bar" },
		});

		expect(capturedUrl?.searchParams.get("foo")).toBe("bar");
		expect(capturedUrl?.searchParams.get("apikey")).toBe("key");
	});

	test("fetchService should throw on non-ok response", async () => {
		server.use(
			http.get("http://h/e", () => {
				return new HttpResponse(null, { status: 404, statusText: "Not Found" });
			}),
		);

		await expect(fetchService("http://h", "/e", "k", "v")).rejects.toThrow(
			"HTTP 404: Not Found",
		);
	});
});
