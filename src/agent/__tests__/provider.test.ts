import { afterEach, describe, expect, it, spyOn } from "bun:test";
import {
	fetchWithRateLimitRetry,
	parseRetryAfterMs,
	withReasoningEffort,
} from "../provider";

describe("parseRetryAfterMs", () => {
	it("parses seconds, including fractions", () => {
		expect(parseRetryAfterMs("2")).toBe(2000);
		expect(parseRetryAfterMs("0.5")).toBe(500);
	});

	it("returns null when missing or unparseable", () => {
		expect(parseRetryAfterMs(null)).toBeNull();
		expect(parseRetryAfterMs("soon")).toBeNull();
	});
});

describe("withReasoningEffort", () => {
	afterEach(() => {
		delete process.env.AI_REASONING_EFFORT;
	});
	const init = { method: "POST", body: JSON.stringify({ model: "m", messages: [] }) };

	it("leaves requests alone when the variable is unset", () => {
		expect(withReasoningEffort(init)).toBe(init);
	});

	it("adds reasoning_effort to chat requests only", () => {
		process.env.AI_REASONING_EFFORT = "low";
		expect(JSON.parse(withReasoningEffort(init).body).reasoning_effort).toBe("low");
		const notChat = { body: JSON.stringify({ model: "whisper" }) };
		expect(withReasoningEffort(notChat)).toBe(notChat);
		const formData = { body: new FormData() };
		expect(withReasoningEffort(formData)).toBe(formData);
	});
});

describe("fetchWithRateLimitRetry", () => {
	let fetchSpy: ReturnType<typeof spyOn> | undefined;
	afterEach(() => {
		fetchSpy?.mockRestore();
	});

	it("waits for Retry-After and retries the same request after a 429", async () => {
		const responses = [
			new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } }),
			new Response("ok", { status: 200 }),
		];
		fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => responses.shift()) as any);

		const response = await fetchWithRateLimitRetry("https://llm.test/v1/chat/completions", { method: "POST" });

		expect(response.status).toBe(200);
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("returns other errors immediately", async () => {
		fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => new Response("too large", { status: 413 })) as any);

		const response = await fetchWithRateLimitRetry("https://llm.test/v1/chat/completions");

		expect(response.status).toBe(413);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("switches to the fallback model when the wait is a daily cap", async () => {
		process.env.AI_MODEL_FALLBACKS = "backup-a, backup-b";
		const models: string[] = [];
		fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async (_url: any, init: any) => {
			const model = JSON.parse(init.body).model;
			models.push(model);
			return model === "backup-b"
				? new Response("ok", { status: 200 })
				: new Response("", { status: 429, headers: { "retry-after": "3600" } });
		}) as any);

		const response = await fetchWithRateLimitRetry("https://llm.test/v1/chat/completions", {
			method: "POST",
			body: JSON.stringify({ model: "main", messages: [] }),
		});

		delete process.env.AI_MODEL_FALLBACKS;
		expect(response.status).toBe(200);
		expect(models).toEqual(["main", "backup-a", "backup-b"]);
	});

	it("gives up when asked to wait longer than a minute", async () => {
		fetchSpy = spyOn(globalThis, "fetch").mockImplementation((async () => new Response("", { status: 429, headers: { "retry-after": "3600" } })) as any);

		const response = await fetchWithRateLimitRetry("https://llm.test/v1/chat/completions");

		expect(response.status).toBe(429);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});
});
