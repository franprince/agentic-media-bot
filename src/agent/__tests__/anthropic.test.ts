import { afterEach, describe, expect, it } from "bun:test";
import { generateObject, generateText, tool } from "ai";
import { z } from "zod";
import {
	AnthropicChatModel,
	ThinkingReplayCache,
	convertPrompt,
	getAnthropicEffort,
	sanitizeToolId,
} from "../anthropic";

/** A fake Anthropic client that records request bodies and replays responses. */
function fakeClient(responses: any[]) {
	const requests: any[] = [];
	const client: any = {
		beta: {
			messages: {
				create: async (body: any) => {
					requests.push(structuredClone(body));
					const next = responses.shift();
					if (!next) throw new Error("no more fake responses");
					return next;
				},
			},
		},
	};
	return { client, requests };
}

function message(content: any[], stop_reason = "end_turn") {
	return {
		id: `msg_${Math.random().toString(36).slice(2)}`,
		type: "message",
		role: "assistant",
		model: "claude-haiku-5-5",
		content,
		stop_reason,
		usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
	};
}

const thinking = (signature: string) => ({ type: "thinking", thinking: "", signature });

afterEach(() => {
	delete process.env.AI_REASONING_EFFORT;
});

describe("request shape", () => {
	it("drops sampling params, keeps thinking adaptive and never forces tool_choice", async () => {
		const { client, requests } = fakeClient([message([{ type: "text", text: "hola" }])]);
		const model = new AnthropicChatModel("claude-haiku-5-5", { client, replayCache: new ThinkingReplayCache() });
		await generateText({
			model,
			temperature: 0.3,
			system: "sys",
			prompt: "hi",
			tools: { ping: tool({ description: "p", parameters: z.object({}), execute: async () => "pong" }) },
			toolChoice: "required",
		});
		const body = requests[0];
		expect(body.temperature).toBeUndefined();
		expect(body.top_p).toBeUndefined();
		expect(body.top_k).toBeUndefined();
		expect(body.tool_choice).toBeUndefined();
		expect(body.thinking).toEqual({ type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } });
		expect(body.system).toContain("You must call one of the tools");
		expect(body.tools[0]).toMatchObject({ name: "ping", input_schema: { type: "object" } });
		expect(body.tools[0].input_schema.$schema).toBeUndefined();
	});

	it("never sends server-side fallbacks (Haiku 5.5 has none)", async () => {
		const { client, requests } = fakeClient([message([{ type: "text", text: "a" }])]);
		await generateText({ model: new AnthropicChatModel("claude-haiku-5-5", { client }), prompt: "x" });
		expect(requests[0].fallbacks).toBeUndefined();
		expect(requests[0].betas).toEqual(["thinking-binding-controls-2026-08-01"]);
	});

	it("floors max_tokens so thinking cannot starve a short classifier answer", async () => {
		const { client, requests } = fakeClient([message([{ type: "text", text: "none" }])]);
		await generateText({ model: new AnthropicChatModel("claude-haiku-5-5", { client }), prompt: "x", maxTokens: 400 });
		expect(requests[0].max_tokens).toBe(4096);
	});

	it("maps AI_REASONING_EFFORT to output_config.effort", async () => {
		expect(getAnthropicEffort()).toBeUndefined();
		process.env.AI_REASONING_EFFORT = "low";
		expect(getAnthropicEffort()).toBe("low");
		process.env.AI_REASONING_EFFORT = "minimal";
		expect(getAnthropicEffort()).toBe("low");
		process.env.AI_REASONING_EFFORT = "turbo";
		expect(getAnthropicEffort()).toBeUndefined();

		process.env.AI_REASONING_EFFORT = "medium";
		const { client, requests } = fakeClient([message([{ type: "text", text: "a" }])]);
		await generateText({ model: new AnthropicChatModel("claude-haiku-5-5", { client }), prompt: "x" });
		expect(requests[0].output_config).toEqual({ effort: "medium" });
	});

	it("never ends on an assistant turn (prefill is a 400)", async () => {
		const { client, requests } = fakeClient([message([{ type: "text", text: "final" }])]);
		await generateText({
			model: new AnthropicChatModel("claude-haiku-5-5", { client }),
			messages: [
				{ role: "user", content: "hi" },
				{ role: "assistant", content: "draft" },
			],
		});
		const sent = requests[0].messages;
		expect(sent[sent.length - 1].role).toBe("user");
	});

	it("merges system messages from the messages array into system", async () => {
		const { client, requests } = fakeClient([message([{ type: "text", text: "ok" }])]);
		await generateText({
			model: new AnthropicChatModel("claude-haiku-5-5", { client }),
			messages: [
				{ role: "system", content: "rewrite in Spanish" },
				{ role: "user", content: "hello" },
			],
		});
		expect(requests[0].system).toBe("rewrite in Spanish");
		expect(requests[0].messages).toEqual([{ role: "user", content: [{ type: "text", text: "hello" }] }]);
	});
});

describe("convertPrompt", () => {
	it("pairs tool calls with results and drops orphans from stored history", () => {
		const { messages } = convertPrompt([
			{ role: "assistant", content: [{ type: "text", text: "leading assistant turn" }] },
			{ role: "user", content: [{ type: "text", text: "add Dune" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool-call", toolCallId: "call:1", toolName: "searchMovie", args: { query: "Dune" } },
					{ type: "tool-call", toolCallId: "orphan", toolName: "searchMovie", args: {} },
				],
			},
			{
				role: "tool",
				content: [
					{ type: "tool-result", toolCallId: "call:1", toolName: "searchMovie", result: { id: 1 } },
					{ type: "tool-result", toolCallId: "stray", toolName: "x", result: "?" },
				],
			},
			{ role: "user", content: [{ type: "text", text: "  " }] },
		]);

		expect(messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "add Dune" }] });
		expect(messages[1]).toEqual({
			role: "assistant",
			content: [{ type: "tool_use", id: "call_1", name: "searchMovie", input: { query: "Dune" } }],
		});
		expect(messages[2]).toEqual({
			role: "user",
			content: [{ type: "tool_result", tool_use_id: "call_1", content: '{"id":1}' }],
		});
		expect(messages).toHaveLength(3);
	});

	it("drops an assistant turn whose only content was an unanswered tool call", () => {
		const { messages } = convertPrompt([
			{ role: "user", content: [{ type: "text", text: "a" }] },
			{ role: "assistant", content: [{ type: "tool-call", toolCallId: "x", toolName: "t", args: {} }] },
			{ role: "user", content: [{ type: "text", text: "b" }] },
		]);
		expect(messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
		]);
	});

	it("sanitizes tool ids from other providers", () => {
		expect(sanitizeToolId("call.abc:1")).toBe("call_abc_1");
		expect(sanitizeToolId("toolu_01AbC-x")).toBe("toolu_01AbC-x");
	});
});

describe("thinking replay inside a tool loop", () => {
	it("sends the thinking block back with the tool result, unchanged", async () => {
		const { client, requests } = fakeClient([
			message(
				[thinking("sig-1"), { type: "tool_use", id: "toolu_1", name: "lookup", input: { q: "dune" } }],
				"tool_use",
			),
			message([thinking("sig-2"), { type: "text", text: "Found it." }]),
		]);
		const model = new AnthropicChatModel("claude-haiku-5-5", { client, replayCache: new ThinkingReplayCache() });
		const result = await generateText({
			model,
			system: "sys",
			prompt: "find dune",
			tools: { lookup: tool({ parameters: z.object({ q: z.string() }), execute: async () => ({ id: 42 }) }) },
			maxSteps: 3,
		});
		expect(result.text).toBe("Found it.");
		const assistant = requests[1].messages[1];
		expect(assistant.role).toBe("assistant");
		expect(assistant.content[0]).toEqual({ type: "thinking", thinking: "", signature: "sig-1" });
		expect(assistant.content[1]).toMatchObject({ type: "tool_use", id: "toolu_1" });
		expect(requests[1].messages[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
	});

	it("leaves the thinking out once the conversation before it changed", async () => {
		const cache = new ThinkingReplayCache();
		const { client, requests } = fakeClient([
			message([thinking("sig-1"), { type: "tool_use", id: "toolu_1", name: "lookup", input: {} }], "tool_use"),
			message([{ type: "text", text: "done" }]),
			message([{ type: "text", text: "synthesis" }]),
		]);
		const model = new AnthropicChatModel("claude-haiku-5-5", { client, replayCache: cache });
		const first = await generateText({
			model,
			system: "sys",
			prompt: "q",
			tools: { lookup: tool({ parameters: z.object({}), execute: async () => "r" }) },
			maxSteps: 3,
		});
		// Same messages, different system prompt (the CAPABLE synthesis pass).
		await generateText({
			model,
			system: "sys + synthesize",
			messages: [{ role: "user", content: "q" }, ...first.response.messages],
		});
		const replayed = requests[2].messages.flatMap((m: any) => m.content);
		expect(replayed.some((b: any) => b.type === "thinking")).toBe(false);
		expect(replayed.some((b: any) => b.type === "tool_use" && b.id === "toolu_1")).toBe(true);
	});
});

describe("JSON mode", () => {
	it("works with generateObject mode json and strips code fences", async () => {
		const { client, requests } = fakeClient([
			message([thinking("s"), { type: "text", text: '```json\n{"recommendations":[{"title":"Dune"}]}\n```' }]),
		]);
		const { object } = await generateObject({
			model: new AnthropicChatModel("claude-haiku-5-5", { client }),
			mode: "json",
			schema: z.object({ recommendations: z.array(z.object({ title: z.string() })) }),
			prompt: "recommend",
		});
		expect(object.recommendations[0]?.title).toBe("Dune");
		expect(requests[0].system).toContain("single JSON object");
		expect(requests[0].tool_choice).toBeUndefined();
	});
});

describe("refusals", () => {
	it("maps stop_reason refusal to content-filter", async () => {
		const { client } = fakeClient([
			{ ...message([], "refusal"), stop_details: { type: "refusal", category: "cyber", explanation: "x" } },
		]);
		const result = await generateText({ model: new AnthropicChatModel("claude-haiku-5-5", { client }), prompt: "x" });
		expect(result.finishReason).toBe("content-filter");
		expect(result.text).toBe("");
	});
});

describe("review round 1 regressions", () => {
	const countingTool = () => {
		let runs = 0;
		return {
			get runs() {
				return runs;
			},
			tool: tool({ parameters: z.object({}), execute: async () => { runs++; return "ok"; } }),
		};
	};

	it("does not execute tool calls after a refusal or a max_tokens cut", async () => {
		for (const stop of ["refusal", "max_tokens"]) {
			const pause = countingTool();
			const { client } = fakeClient([
				message([{ type: "tool_use", id: "toolu_x", name: "pauseAll", input: {} }], stop),
			]);
			await generateText({
				model: new AnthropicChatModel("claude-haiku-5-5", { client }),
				prompt: "pause everything",
				tools: { pauseAll: pause.tool },
				maxSteps: 3,
			});
			expect(pause.runs).toBe(0);
		}
	});

	it("does not restore a cached turn whose tool call was edited", () => {
		const cache = new ThinkingReplayCache();
		cache.remember("fp", [
			thinking("sig") as any,
			{ type: "tool_use", id: "toolu_1", name: "addMovie", input: { tmdbId: 1 } } as any,
		]);
		const same = [{ type: "tool_use", id: "toolu_1", name: "addMovie", input: { tmdbId: 1 } }] as any;
		const edited = [{ type: "tool_use", id: "toolu_1", name: "addMovie", input: { tmdbId: 2 } }] as any;
		expect(cache.recall("fp", same)?.[0]).toMatchObject({ type: "thinking", signature: "sig" });
		expect(cache.recall("fp", edited)).toBeUndefined();
		expect(cache.recall("other-fp", same)).toBeUndefined();
	});

	it("drops the results of a leading assistant tool call together with it", () => {
		const { messages } = convertPrompt([
			{ role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "t", args: {} }] },
			{ role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "t", result: "r" }] },
			{ role: "user", content: [{ type: "text", text: "next" }] },
		]);
		expect(messages).toEqual([{ role: "user", content: [{ type: "text", text: "next" }] }]);
	});

	it("keeps distinct legacy ids distinct after sanitizing", () => {
		const { messages } = convertPrompt([
			{ role: "user", content: [{ type: "text", text: "q" }] },
			{
				role: "assistant",
				content: [
					{ type: "tool-call", toolCallId: "a:b", toolName: "t", args: { n: 1 } },
					{ type: "tool-call", toolCallId: "a.b", toolName: "t", args: { n: 2 } },
				],
			},
			{
				role: "tool",
				content: [
					{ type: "tool-result", toolCallId: "a:b", toolName: "t", result: "one" },
					{ type: "tool-result", toolCallId: "a.b", toolName: "t", result: "two" },
				],
			},
		]);
		const ids = (messages[1]?.content as any[]).map((b) => b.id);
		expect(new Set(ids).size).toBe(2);
		const results = messages[2]?.content as any[];
		expect(results.map((r) => [r.tool_use_id, r.content])).toEqual([
			[ids[0], "one"],
			[ids[1], "two"],
		]);
	});
});

describe("review round 2 regressions", () => {
	it("drops two leading call/result pairs before the first user message", () => {
		const { messages } = convertPrompt([
			{ role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName: "t", args: {} }] },
			{ role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName: "t", result: "r1" }] },
			{ role: "assistant", content: [{ type: "tool-call", toolCallId: "c2", toolName: "t", args: {} }] },
			{ role: "tool", content: [{ type: "tool-result", toolCallId: "c2", toolName: "t", result: "r2" }] },
			{ role: "user", content: [{ type: "text", text: "next" }] },
		]);
		expect(messages).toEqual([{ role: "user", content: [{ type: "text", text: "next" }] }]);
	});

	it("still replays when inputs differ only in key order or Zod defaults", () => {
		const cache = new ThinkingReplayCache();
		cache.remember("fp", [
			thinking("sig") as any,
			{ type: "tool_use", id: "toolu_1", name: "addMovie", input: { b: 2, a: 1 } } as any,
		]);
		const reordered = [{ type: "tool_use", id: "toolu_1", name: "addMovie", input: { a: 1, b: 2 } }] as any;
		const withDefault = [
			{ type: "tool_use", id: "toolu_1", name: "addMovie", input: { a: 1, b: 2, confirm: false } },
		] as any;
		const renamed = [{ type: "tool_use", id: "toolu_1", name: "removeMovie", input: { a: 1, b: 2 } }] as any;
		const schema = [
			{
				name: "addMovie",
				input_schema: { type: "object", properties: { a: {}, b: {}, confirm: { type: "boolean", default: false } } },
			},
		] as any;
		const confirmed = [
			{ type: "tool_use", id: "toolu_1", name: "addMovie", input: { a: 1, b: 2, confirm: true } },
		] as any;
		expect(cache.recall("fp", reordered, schema)).toBeDefined();
		expect(cache.recall("fp", withDefault, schema)).toBeDefined();
		// An added key is only accepted when it is the schema default.
		expect(cache.recall("fp", confirmed, schema)).toBeUndefined();
		expect(cache.recall("fp", withDefault)).toBeUndefined();
		expect(cache.recall("fp", renamed, schema)).toBeUndefined();
	});

	it("replays thinking in a real loop whose tool schema has a default", async () => {
		const { client, requests } = fakeClient([
			message([thinking("sig-1"), { type: "tool_use", id: "toolu_1", name: "add", input: { id: 7 } }], "tool_use"),
			message([{ type: "text", text: "done" }]),
		]);
		await generateText({
			model: new AnthropicChatModel("claude-haiku-5-5", { client, replayCache: new ThinkingReplayCache() }),
			prompt: "add 7",
			tools: {
				add: tool({
					parameters: z.object({ id: z.number(), confirm: z.boolean().default(false) }),
					execute: async () => "ok",
				}),
			},
			maxSteps: 3,
		});
		expect(requests[1].messages[1].content[0]).toEqual({ type: "thinking", thinking: "", signature: "sig-1" });
	});
});

describe("review round 3 regressions", () => {
	it("does not replay when a key Claude sent as null was removed", () => {
		const cache = new ThinkingReplayCache();
		cache.remember("fp", [
			thinking("sig") as any,
			{ type: "tool_use", id: "toolu_1", name: "t", input: { year: null } } as any,
		]);
		expect(cache.recall("fp", [{ type: "tool_use", id: "toolu_1", name: "t", input: { year: null } }] as any)).toBeDefined();
		expect(cache.recall("fp", [{ type: "tool_use", id: "toolu_1", name: "t", input: {} }] as any)).toBeUndefined();
	});

	it("keeps an attachment-only turn as a note instead of dropping it", () => {
		const { messages } = convertPrompt([
			{ role: "user", content: [{ type: "file", data: "AAAA", mimeType: "audio/ogg" }] },
		]);
		expect(messages).toEqual([
			{ role: "user", content: [{ type: "text", text: "[Attachment not supported by this model: audio/ogg]" }] },
		]);
	});
});

describe("latency options", () => {
	it("enables automatic prompt caching on every request", async () => {
		const { client, requests } = fakeClient([message([{ type: "text", text: "ok" }])]);
		await generateText({ model: new AnthropicChatModel("claude-haiku-5-5", { client }), prompt: "x" });
		expect(requests[0].cache_control).toEqual({ type: "ephemeral" });
	});

	it("takes a per-call effort and thinking-off override", async () => {
		const { client, requests } = fakeClient([message([{ type: "text", text: "{}" }])]);
		await generateText({
			model: new AnthropicChatModel("claude-haiku-5-5", { client }),
			prompt: "x",
			experimental_providerMetadata: { anthropic: { effort: "low", thinking: "off" } },
		});
		expect(requests[0].thinking).toEqual({ type: "disabled" });
		expect(requests[0].output_config).toEqual({ effort: "low" });
	});

	it("caps effort at high when thinking is turned off", async () => {
		process.env.AI_REASONING_EFFORT = "max";
		const { client, requests } = fakeClient([message([{ type: "text", text: "ok" }])]);
		await generateText({
			model: new AnthropicChatModel("claude-haiku-5-5", { client }),
			prompt: "x",
			experimental_providerMetadata: { anthropic: { thinking: "off" } },
		});
		expect(requests[0].thinking).toEqual({ type: "disabled" });
		expect(requests[0].output_config).toEqual({ effort: "high" });
	});
});
