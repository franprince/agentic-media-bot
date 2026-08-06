import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { classifyIntent } from "../ollamaClassifier";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

describe("ollamaClassifier.classifyIntent", () => {
	beforeEach(() => {
		process.env.OLLAMA_BASE_URL = "http://ollama.local:11434";
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		globalThis.fetch = originalFetch;
	});

	it("returns the classified domain and confidence on a valid response", async () => {
		let capturedUrl = "";
		globalThis.fetch = (async (input: any) => {
			capturedUrl = String(input);
			return new Response(
				JSON.stringify({
					response: JSON.stringify({ domain: "service-health", confidence: 0.92 }),
				}),
				{ status: 200 },
			);
		}) as any;

		const result = await classifyIntent("is sonarr up?");

		expect(capturedUrl).toBe("http://ollama.local:11434/api/generate");
		expect(result).toEqual({ domain: "service-health", confidence: 0.92 });
	});

	it("recognizes the download-queue domain", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					response: JSON.stringify({ domain: "download-queue", confidence: 0.8 }),
				}),
				{ status: 200 },
			)) as any;

		const result = await classifyIntent("pause all torrents");

		expect(result).toEqual({ domain: "download-queue", confidence: 0.8 });
	});

	it("fails open to {domain:null, confidence:0} when fetch throws (Ollama/proxy unreachable)", async () => {
		globalThis.fetch = (async () => {
			throw new Error("connection refused");
		}) as any;

		const result = await classifyIntent("anything");

		expect(result).toEqual({ domain: null, confidence: 0 });
	});

	it("fails open on a non-2xx response", async () => {
		globalThis.fetch = (async () => new Response("error", { status: 500 })) as any;

		const result = await classifyIntent("anything");

		expect(result).toEqual({ domain: null, confidence: 0 });
	});

	it("fails open when the model's response isn't valid JSON", async () => {
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ response: "not json" }), { status: 200 })) as any;

		const result = await classifyIntent("anything");

		expect(result).toEqual({ domain: null, confidence: 0 });
	});

	it("fails open when the model reports an unrecognized domain", async () => {
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					response: JSON.stringify({ domain: "add-movie", confidence: 0.9 }),
				}),
				{ status: 200 },
			)) as any;

		const result = await classifyIntent("add the movie Dune");

		expect(result).toEqual({ domain: null, confidence: 0 });
	});
});
