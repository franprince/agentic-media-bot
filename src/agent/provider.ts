import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";

/**
 * Single place that builds the chat models, so every call site (agent loop,
 * TMDB recommendations, verify-config) agrees on base URL, API key and
 * rate-limit handling.
 *
 * AI_PROVIDER=ollama is the generic OpenAI-compatible path: OLLAMA_BASE_URL may
 * point at a local Ollama or at a hosted endpoint (Groq, OpenRouter, ...), in
 * which case OLLAMA_API_KEY carries that service's key.
 */

const DEFAULT_MODEL = "minimax-m2.7:cloud";
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RATE_LIMIT_WAIT_MS = 65_000;

export function getOllamaBaseUrl(): string {
	return (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(
		/\/$/,
		"",
	);
}

export function isOllamaProvider(): boolean {
	return process.env.AI_PROVIDER === "ollama";
}

export function getFastModelName(): string {
	return process.env.AI_MODEL_FAST || process.env.AI_MODEL || DEFAULT_MODEL;
}

export function getCapableModelName(): string {
	return process.env.AI_MODEL_CAPABLE || getFastModelName();
}

/** Parses a Retry-After header (seconds or HTTP date) into milliseconds. */
export function parseRetryAfterMs(value: string | null): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
	const date = Date.parse(value);
	if (Number.isNaN(date)) return null;
	return Math.max(0, date - Date.now());
}

/**
 * Adds `reasoning_effort` to chat requests when AI_REASONING_EFFORT is set
 * (e.g. "low"). Reasoning models spend completion tokens thinking, and those
 * count against the provider's tokens-per-minute cap like any others.
 */
export function withReasoningEffort(init?: any): any {
	const effort = process.env.AI_REASONING_EFFORT;
	if (!effort || typeof init?.body !== "string") return init;
	try {
		const body = JSON.parse(init.body);
		if (!Array.isArray(body?.messages) || body.reasoning_effort) return init;
		return { ...init, body: JSON.stringify({ ...body, reasoning_effort: effort }) };
	} catch {
		return init;
	}
}

/**
 * Waits out HTTP 429s at the request level. Hosted free tiers cap tokens per
 * minute, and a tool-calling turn is several requests; retrying the single
 * rejected request (instead of the whole generateText call) means tools that
 * already ran in earlier steps are not executed twice.
 */
export async function fetchWithRateLimitRetry(
	input: any,
	init?: any,
): Promise<Response> {
	const request = withReasoningEffort(init);
	for (let attempt = 0; ; attempt++) {
		const response = await fetch(input, request);
		if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) {
			return response;
		}
		const waitMs =
			parseRetryAfterMs(response.headers.get("retry-after")) ??
			5000 * (attempt + 1);
		if (waitMs > MAX_RATE_LIMIT_WAIT_MS) return response;
		console.warn(
			`⏳ LLM rate limit hit (429). Waiting ${Math.ceil(waitMs / 1000)}s before retrying (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES}).`,
		);
		await new Promise((resolve) => setTimeout(resolve, waitMs + 250));
	}
}

export function createOllamaProvider() {
	return createOpenAI({
		baseURL: `${getOllamaBaseUrl()}/v1`,
		apiKey: process.env.OLLAMA_API_KEY || "ollama",
		fetch: fetchWithRateLimitRetry as any,
	});
}

/** Model for the tool-calling loop. */
export function getFastModel(): any {
	return isOllamaProvider()
		? createOllamaProvider()(getFastModelName())
		: google(getFastModelName());
}

/** Model for synthesis, language rewrite and recommendations. */
export function getCapableModel(): any {
	return isOllamaProvider()
		? createOllamaProvider()(getCapableModelName())
		: google(getCapableModelName());
}
