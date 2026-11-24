import Anthropic from "@anthropic-ai/sdk";
import type {
	LanguageModelV1,
	LanguageModelV1CallOptions,
	LanguageModelV1Prompt,
} from "ai";

/**
 * AI_PROVIDER=anthropic: an AI SDK (v1 spec) language model for Claude
 * Haiku 5.5 (the only Claude model the bot uses), backed by the official
 * Anthropic SDK, so the existing generateText call sites, tools and stored
 * CoreMessage history keep working unchanged.
 *
 * Haiku 5.5 request rules this adapter enforces, because each one is a 400:
 *   - no temperature / top_p / top_k;
 *   - no trailing assistant message (prefill);
 *   - a thinking block may only be sent back when everything before it is
 *     byte-identical to the request that produced it (the history-editing
 *     check). See ThinkingReplayCache.
 * Thinking is adaptive and on by default; forced tool_choice is accepted but
 * skips thinking, so it is turned into "auto" plus a prompt instruction.
 */

type GenerateResult = Awaited<ReturnType<LanguageModelV1["doGenerate"]>>;
type LanguageModelV1CallWarning = NonNullable<GenerateResult["warnings"]>[number];
type LanguageModelV1FinishReason = GenerateResult["finishReason"];
type LanguageModelV1FunctionToolCall = NonNullable<GenerateResult["toolCalls"]>[number];
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type BetaTool = Anthropic.Beta.Messages.BetaTool;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
/**
 * A user or assistant turn with array content: the subset of the SDK's
 * BetaMessageParam this adapter produces (no system turns, no string content).
 */
type BetaMessageParam = {
	role: "user" | "assistant";
	content: BetaContentBlockParam[];
};
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The bot's only Claude model (measured choice: specs/2026-11-20-claude-provider). */
export const ANTHROPIC_MODEL = "claude-haiku-5-5";
const DEFAULT_MAX_TOKENS = 16_000;
/** Thinking spends max_tokens too; a 400-token cap can end before any text. */
const MIN_MAX_TOKENS = 4_096;
const THINKING_BINDING_BETA = "thinking-binding-controls-2026-08-01";
const EFFORTS: readonly Effort[] = ["low", "medium", "high", "xhigh", "max"];

/**
 * output_config.effort for a call: a per-call override
 * (`experimental_providerMetadata: { anthropic: { effort: "low" } }`), else
 * AI_REASONING_EFFORT, else the model default.
 */
export function getAnthropicEffort(override?: unknown): Effort | undefined {
	if (typeof override === "string" && (EFFORTS as readonly string[]).includes(override)) {
		return override as Effort;
	}
	const raw = (process.env.AI_REASONING_EFFORT || "").trim().toLowerCase();
	if (!raw) return undefined;
	if ((EFFORTS as readonly string[]).includes(raw)) return raw as Effort;
	// OpenAI-style values used by the other providers.
	if (raw === "minimal" || raw === "none") return "low";
	console.warn(
		`⚠️ AI_REASONING_EFFORT="${raw}" is not a Claude effort level (${EFFORTS.join(", ")}); using the model default.`,
	);
	return undefined;
}

// ---------------------------------------------------------------------------
// Thinking replay
// ---------------------------------------------------------------------------

/** Small stable hash (FNV-1a, 64-bit via two 32-bit lanes). */
function hash(text: string): string {
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
		h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
	}
	return `${h1.toString(16)}${h2.toString(16)}`;
}

function withoutThinking(messages: BetaMessageParam[]): BetaMessageParam[] {
	return messages.map((message) => ({
		...message,
		content: message.content.filter(
			(block) => block.type !== "thinking" && block.type !== "redacted_thinking",
		),
	}));
}

/**
 * What a thinking block is bound to: the model, `system`, the tool set and
 * every message before it (earlier thinking blocks excluded).
 */
export function conversationFingerprint(
	model: string,
	system: string | undefined,
	tools: BetaTool[] | undefined,
	priorMessages: BetaMessageParam[],
): string {
	const sortedTools = [...(tools ?? [])].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	return hash(
		JSON.stringify([model, system ?? "", sortedTools, withoutThinking(priorMessages)]),
	);
}

/**
 * The AI SDK v1 prompt has no slot for thinking blocks, so the assistant turns
 * it sends back have lost them. Within one tool loop (one generateText call)
 * the API expects them back with the tool results, so the raw assistant
 * content is kept here, keyed by its tool_use ids, and restored when — and only
 * when — the conversation before it is unchanged. In every other case (history
 * compacted for the token budget, a new turn with a rebuilt system prompt, the
 * CAPABLE synthesis pass) the blocks are left out, which the API accepts.
 */
export class ThinkingReplayCache {
	private entries = new Map<
		string,
		{ fingerprint: string; content: BetaContentBlockParam[] }
	>();

	constructor(private readonly maxEntries = 500) {}

	remember(fingerprint: string, content: BetaContentBlock[]): void {
		const toolUseIds = content
			.filter((block) => block.type === "tool_use")
			.map((block: any) => block.id as string);
		if (toolUseIds.length === 0) return;
		if (!content.some((block) => block.type === "thinking" || block.type === "redacted_thinking")) {
			return;
		}
		const params = content
			.map(toReplayParam)
			.filter((block): block is BetaContentBlockParam => block !== null);
		const entry = { fingerprint, content: params };
		for (const id of toolUseIds) {
			this.entries.delete(id);
			this.entries.set(id, entry);
		}
		while (this.entries.size > this.maxEntries) {
			const oldest = this.entries.keys().next().value;
			if (oldest === undefined) break;
			this.entries.delete(oldest);
		}
	}

	/**
	 * Raw content for this assistant turn, if it was produced under the same
	 * fingerprint and is still the same turn (see sameTurn). Anything else — an
	 * edited call, a different turn reusing an id — gets undefined, and the
	 * turn is sent as is, without thinking.
	 */
	recall(
		fingerprint: string,
		current: BetaContentBlockParam[],
		tools: BetaTool[] = [],
	): BetaContentBlockParam[] | undefined {
		const firstToolUse = current.find((block) => block.type === "tool_use") as
			| { id: string }
			| undefined;
		if (!firstToolUse) return undefined;
		const entry = this.entries.get(firstToolUse.id);
		if (!entry || entry.fingerprint !== fingerprint) return undefined;
		const schemas = new Map(tools.map((tool) => [tool.name, tool.input_schema]));
		if (!sameTurn(entry.content, current, schemas)) return undefined;
		return entry.content;
	}

	get size(): number {
		return this.entries.size;
	}
}

/** JSON with object keys sorted, so key order never counts as a change. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value as object)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical((value as any)[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value ?? null);
}

function turnText(content: BetaContentBlockParam[]): string {
	return content
		.filter((block) => block.type === "text")
		.map((block: any) => block.text as string)
		.join("")
		.trim();
}

/**
 * Whether the turn the AI SDK sends back is still the turn Claude produced:
 * same text, same ordered tool ids and names, and every input field Claude
 * sent present and unchanged. An extra field is allowed only when it equals
 * that property's schema default (the AI SDK sends the validated input, which
 * includes Zod defaults such as `confirm: false`) — never e.g. `confirm: true`.
 */
function sameTurn(
	cached: BetaContentBlockParam[],
	current: BetaContentBlockParam[],
	schemas: Map<string, BetaTool["input_schema"]>,
): boolean {
	if (turnText(cached) !== turnText(current)) return false;
	const calls = (content: BetaContentBlockParam[]) =>
		content.filter((block) => block.type === "tool_use") as Array<{
			id: string;
			name: string;
			input: unknown;
		}>;
	const before = calls(cached);
	const after = calls(current);
	if (before.length !== after.length) return false;
	return before.every((call, i) => {
		const other = after[i];
		if (!other || other.id !== call.id || other.name !== call.name) return false;
		const original = (call.input ?? {}) as Record<string, unknown>;
		const now = (other.input ?? {}) as Record<string, unknown>;
		const keptAll = Object.keys(original).every(
			(key) => Object.hasOwn(now, key) && canonical(original[key]) === canonical(now[key]),
		);
		if (!keptAll) return false;
		const properties = ((schemas.get(call.name) as any)?.properties ?? {}) as Record<string, any>;
		return Object.keys(now)
			.filter((key) => !Object.hasOwn(original, key))
			.every(
				(key) =>
					properties[key] &&
					Object.hasOwn(properties[key], "default") &&
					canonical(properties[key].default) === canonical(now[key]),
			);
	});
}

/** A response block as it must be sent back; null for blocks never replayed. */
function toReplayParam(block: BetaContentBlock): BetaContentBlockParam | null {
	switch (block.type) {
		case "thinking":
			return { type: "thinking", thinking: block.thinking, signature: block.signature };
		case "redacted_thinking":
			return { type: "redacted_thinking", data: block.data };
		case "text":
			return block.text ? { type: "text", text: block.text } : null;
		case "tool_use":
			return { type: "tool_use", id: block.id, name: block.name, input: block.input };
		default:
			return null;
	}
}

// ---------------------------------------------------------------------------
// Prompt conversion
// ---------------------------------------------------------------------------

/** Anthropic tool ids must match ^[a-zA-Z0-9_-]+$; other providers' may not. */
export function sanitizeToolId(id: string): string {
	const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	return cleaned || "tool_call";
}

/**
 * Maps original tool-call ids to wire ids for one request, keeping distinct
 * originals distinct ("a:b" and "a.b" both sanitize to "a_b").
 */
function createToolIdMapper(): (id: string) => string {
	const byOriginal = new Map<string, string>();
	const used = new Set<string>();
	return (id: string) => {
		const known = byOriginal.get(id);
		if (known) return known;
		const base = sanitizeToolId(id);
		let wire = base;
		for (let n = 2; used.has(wire); n++) wire = `${base}_${n}`;
		byOriginal.set(id, wire);
		used.add(wire);
		return wire;
	};
}

function toBase64(data: Uint8Array | string): string {
	return typeof data === "string" ? data : Buffer.from(data).toString("base64");
}

function toolResultContent(result: unknown): string {
	if (typeof result === "string") return result || "(empty)";
	try {
		return JSON.stringify(result ?? null);
	} catch {
		return String(result);
	}
}

export interface ConvertedPrompt {
	system: string | undefined;
	messages: BetaMessageParam[];
}

/**
 * Converts the AI SDK prompt to Messages API shape and repairs what the API
 * would reject: leading non-user turns, orphaned tool calls or results (left
 * over from a crashed turn, or from history stored under another provider),
 * empty blocks, and a trailing assistant turn.
 */
export function convertPrompt(prompt: LanguageModelV1Prompt): ConvertedPrompt {
	const systemParts: string[] = [];
	const raw: BetaMessageParam[] = [];
	const toolId = createToolIdMapper();

	for (const message of prompt) {
		switch (message.role) {
			case "system":
				if (message.content.trim()) systemParts.push(message.content);
				break;
			case "user": {
				const content: BetaContentBlockParam[] = [];
				for (const part of message.content) {
					if (part.type === "text") {
						if (part.text.trim()) content.push({ type: "text", text: part.text });
					} else if (part.type === "image") {
						const mediaType = (part.mimeType || "image/jpeg") as any;
						content.push(
							part.image instanceof URL
								? { type: "image", source: { type: "url", url: part.image.toString() } }
								: {
										type: "image",
										source: { type: "base64", media_type: mediaType, data: toBase64(part.image) },
									},
						);
					} else if (part.type === "file") {
						if (part.mimeType === "application/pdf") {
							content.push(
								part.data instanceof URL
									? { type: "document", source: { type: "url", url: part.data.toString() } }
									: {
											type: "document",
											source: { type: "base64", media_type: "application/pdf", data: toBase64(part.data) },
										},
							);
						}
						else {
							// Audio and other files: voice notes are transcribed before
							// they reach the agent. Say so rather than drop the turn.
							content.push({
								type: "text",
								text: `[Attachment not supported by this model: ${part.mimeType}]`,
							});
						}
					}
				}
				if (content.length > 0) raw.push({ role: "user", content });
				break;
			}
			case "assistant": {
				const content: BetaContentBlockParam[] = [];
				for (const part of message.content) {
					if (part.type === "text") {
						if (part.text.trim()) content.push({ type: "text", text: part.text });
					} else if (part.type === "tool-call") {
						content.push({
							type: "tool_use",
							id: toolId(part.toolCallId),
							name: part.toolName,
							input: (part.args && typeof part.args === "object" ? part.args : {}) as any,
						});
					}
				}
				if (content.length > 0) raw.push({ role: "assistant", content });
				break;
			}
			case "tool": {
				const content: BetaContentBlockParam[] = message.content.map((part) => ({
					type: "tool_result",
					tool_use_id: toolId(part.toolCallId),
					content: toolResultContent(part.result),
					...(part.isError ? { is_error: true } : {}),
				}));
				if (content.length > 0) raw.push({ role: "user", content });
				break;
			}
		}
	}

	return {
		system: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
		messages: repairMessages(raw),
	};
}

function blocks(message: BetaMessageParam): BetaContentBlockParam[] {
	return message.content;
}

/** Merges same-role neighbours and enforces tool_use / tool_result pairing. */
export function repairMessages(input: BetaMessageParam[]): BetaMessageParam[] {
	// 0. The conversation starts at the first user message with something the
	//    user said. Anything before it (assistant turns and the tool results
	//    answering them) is dropped as a unit; results that remain in that
	//    message without their call are removed by the pairing step below.
	const start = input.findIndex(
		(message) =>
			message.role === "user" &&
			message.content.some((block) => block.type !== "tool_result"),
	);
	if (start > 0) input = input.slice(start);
	else if (start < 0) input = [];

	// 1. Merge consecutive messages of the same role.
	const merged: BetaMessageParam[] = [];
	for (const message of input) {
		const last = merged[merged.length - 1];
		if (last && last.role === message.role) {
			last.content = [...blocks(last), ...blocks(message)];
		} else {
			merged.push({ role: message.role, content: [...blocks(message)] });
		}
	}

	// 2. A tool_use must be answered by a tool_result in the very next user
	//    message, and a tool_result must answer a tool_use in the message just
	//    before it. Drop whichever half is missing.
	for (let i = 0; i < merged.length; i++) {
		const message = merged[i] as BetaMessageParam;
		const content = blocks(message);
		if (message.role === "assistant") {
			const next = merged[i + 1];
			const answered = new Set(
				next && next.role === "user"
					? blocks(next)
							.filter((block) => block.type === "tool_result")
							.map((block: any) => block.tool_use_id)
					: [],
			);
			message.content = content.filter(
				(block) => block.type !== "tool_use" || answered.has((block as any).id),
			);
		} else {
			const previous = merged[i - 1];
			const asked = new Set(
				previous && previous.role === "assistant"
					? blocks(previous)
							.filter((block) => block.type === "tool_use")
							.map((block: any) => block.id)
					: [],
			);
			const results = content.filter(
				(block) =>
					block.type === "tool_result" && asked.has((block as any).tool_use_id),
			);
			// tool_result blocks must come first in the user message.
			message.content = [
				...results,
				...content.filter((block) => block.type !== "tool_result"),
			];
		}
	}

	// 3. Drop messages left empty, re-merge, and start with a user turn.
	const cleaned: BetaMessageParam[] = [];
	for (const message of merged) {
		if (blocks(message).length === 0) continue;
		const last = cleaned[cleaned.length - 1];
		if (last && last.role === message.role) {
			last.content = [...blocks(last), ...blocks(message)];
		} else {
			cleaned.push(message);
		}
	}
	while (cleaned.length > 0 && cleaned[0]?.role !== "user") cleaned.shift();
	// A first user turn that only held tool results lost them above.
	if (cleaned.length === 0) {
		cleaned.push({ role: "user", content: [{ type: "text", text: "(continue)" }] });
	}
	return cleaned;
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

function mapFinishReason(stopReason: string | null | undefined): LanguageModelV1FinishReason {
	switch (stopReason) {
		case "end_turn":
		case "stop_sequence":
		case "pause_turn":
			return "stop";
		case "tool_use":
			return "tool-calls";
		case "max_tokens":
		case "model_context_window_exceeded":
			return "length";
		case "refusal":
			return "content-filter";
		default:
			return "other";
	}
}

/** One line per request: what was read from cache, what was written, how long it took. */
export function formatUsageLog(usage: any, elapsedMs: number, stopReason: string | null | undefined): string {
	return [
		`📊 Claude call: input ${usage?.input_tokens ?? 0}`,
		`cache read ${usage?.cache_read_input_tokens ?? 0}`,
		`cache write ${usage?.cache_creation_input_tokens ?? 0}`,
		`output ${usage?.output_tokens ?? 0}`,
		`${Math.round(elapsedMs)} ms`,
		`stop ${stopReason ?? "unknown"}`,
	].join(" · ");
}

function stripCodeFence(text: string): string {
	const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return match?.[1] ?? text;
}

function toInputSchema(parameters: any): BetaTool["input_schema"] {
	const { $schema: _ignored, ...schema } = (parameters ?? {}) as Record<string, any>;
	return { ...schema, type: "object" } as BetaTool["input_schema"];
}

export interface AnthropicChatModelOptions {
	client?: Anthropic;
	replayCache?: ThinkingReplayCache;
}

let sharedClient: Anthropic | undefined;
const sharedReplayCache = new ThinkingReplayCache();

function getSharedClient(): Anthropic {
	// Reads ANTHROPIC_API_KEY (or another configured credential) from the env.
	sharedClient ??= new Anthropic({ maxRetries: 3 });
	return sharedClient;
}

export class AnthropicChatModel implements LanguageModelV1 {
	readonly specificationVersion = "v1";
	readonly provider = "anthropic";
	readonly defaultObjectGenerationMode = "json" as const;
	readonly supportsImageUrls = true;
	readonly modelId: string;
	private readonly client: Anthropic | undefined;
	private readonly replayCache: ThinkingReplayCache;

	constructor(modelId: string, options: AnthropicChatModelOptions = {}) {
		this.modelId = modelId;
		this.client = options.client;
		this.replayCache = options.replayCache ?? sharedReplayCache;
	}

	/** Builds the Messages API request; exported for tests. */
	buildRequest(options: LanguageModelV1CallOptions): {
		body: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
		warnings: LanguageModelV1CallWarning[];
	} {
		const warnings: LanguageModelV1CallWarning[] = [];
		for (const setting of ["temperature", "topP", "topK"] as const) {
			// ai@3 sends temperature 0 by default; current Claude models reject
			// any sampling parameter, so they are dropped silently unless set.
			if (options[setting] !== undefined && !(setting === "temperature" && options[setting] === 0)) {
				warnings.push({ type: "unsupported-setting", setting });
			}
		}

		const { system: promptSystem, messages: converted } = convertPrompt(options.prompt);
		let system = promptSystem;
		let tools: BetaTool[] | undefined;
		let toolChoice: Anthropic.Beta.Messages.BetaToolChoice | undefined;

		const mode = options.mode;
		if (mode.type === "regular") {
			if (mode.tools && mode.tools.length > 0) {
				tools = mode.tools
					.filter((tool) => tool.type === "function")
					.map((tool: any) => ({
						name: tool.name,
						description: tool.description,
						input_schema: toInputSchema(tool.parameters),
					}));
				const choice = mode.toolChoice;
				if (choice?.type === "none") {
					toolChoice = { type: "none" };
				} else if (choice?.type === "required" || choice?.type === "tool") {
					// A forced call on Haiku 5.5 skips thinking; ask in the prompt instead.
					warnings.push({
						type: "other",
						message:
							"tool_choice is sent as auto (a forced call skips thinking); the tool is requested in the prompt instead.",
					});
					const target = choice.type === "tool" ? `the ${choice.toolName} tool` : "one of the tools";
					system = [system, `You must call ${target} before answering.`].filter(Boolean).join("\n\n");
				}
			}
		} else if (mode.type === "object-json") {
			system = [
				system,
				"Reply with a single JSON object only: no prose before or after it and no code fences.",
			]
				.filter(Boolean)
				.join("\n\n");
		} else {
			throw new Error(
				`AnthropicChatModel does not support "${mode.type}" mode; use generateObject with mode: "json".`,
			);
		}

		// A trailing assistant turn is a prefill, which these models reject.
		const messages = [...converted];
		if (messages[messages.length - 1]?.role === "assistant") {
			messages.push({
				role: "user",
				content: [{ type: "text", text: "Write your final reply to the user now." }],
			});
		}

		// Restore thinking blocks for assistant turns whose prefix is unchanged.
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i] as BetaMessageParam;
			if (message.role !== "assistant") continue;
			if (!message.content.some((block) => block.type === "tool_use")) continue;
			const fingerprint = conversationFingerprint(
				this.modelId,
				system,
				tools,
				messages.slice(0, i),
			);
			const restored = this.replayCache.recall(fingerprint, message.content, tools);
			if (restored) messages[i] = { role: "assistant", content: restored };
		}

		const callOptions = (options as any).providerMetadata?.anthropic ?? {};
		let effort = getAnthropicEffort(callOptions.effort);
		// Per-call `thinking: "off"` for short, simple outputs (recommendation
		// lists): Haiku otherwise thinks ~500 tokens before a ~150-token answer.
		// Haiku 5.5 accepts thinking "disabled" only at effort high or below.
		const thinkingOff = callOptions.thinking === "off";
		if (thinkingOff && (effort === "xhigh" || effort === "max")) effort = "high";

		const body: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
			model: this.modelId,
			max_tokens: Math.max(options.maxTokens ?? DEFAULT_MAX_TOKENS, MIN_MAX_TOKENS),
			messages,
			// Belt and braces: if a replayed block still fails the
			// history-editing check, drop it instead of failing the request.
			thinking: thinkingOff
				? { type: "disabled" }
				: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } },
			betas: [THINKING_BINDING_BETA],
			// Automatic prompt caching: the tool loop resends the same system
			// prompt, tools and history on every step, so later steps read them
			// from cache (faster first token, 0.1x input price).
			cache_control: { type: "ephemeral" },
			...(system ? { system } : {}),
			...(tools ? { tools } : {}),
			...(toolChoice ? { tool_choice: toolChoice } : {}),
			...(effort ? { output_config: { effort } } : {}),
			...(options.stopSequences?.length ? { stop_sequences: options.stopSequences } : {}),
		};
		return { body, warnings };
	}

	async doGenerate(options: LanguageModelV1CallOptions) {
		const { body, warnings } = this.buildRequest(options);
		const client = this.client ?? getSharedClient();
		const startedAt = performance.now();
		const response: BetaMessage = await client.beta.messages.create(body, {
			signal: options.abortSignal,
			headers: options.headers as Record<string, string> | undefined,
		});
		console.log(formatUsageLog(response.usage, performance.now() - startedAt, response.stop_reason));

		const answer = response.content;

		// Remember the raw turn so its thinking can go back with the tool results.
		const fingerprint = conversationFingerprint(
			this.modelId,
			body.system as string | undefined,
			body.tools as BetaTool[] | undefined,
			body.messages as unknown as BetaMessageParam[],
		);
		this.replayCache.remember(fingerprint, answer);

		let text = answer
			.filter((block) => block.type === "text")
			.map((block: any) => block.text as string)
			.join("");
		if (options.mode.type === "object-json") text = stripCodeFence(text);

		// Tools run only when the model actually stopped to call them: never after
		// a refusal or a max_tokens cut (a half-planned call).
		const toolCalls: LanguageModelV1FunctionToolCall[] =
			response.stop_reason === "tool_use"
				? answer
						.filter((block) => block.type === "tool_use")
						.map((block: any) => ({
							toolCallType: "function",
							toolCallId: block.id,
							toolName: block.name,
							args: JSON.stringify(block.input ?? {}),
						}))
				: [];

		if (response.stop_reason === "refusal") {
			const details = (response as any).stop_details;
			console.warn(
				`⚠️ Claude declined the request (${details?.category ?? "no category"}): ${details?.explanation ?? ""}`,
			);
		}

		const usage = response.usage as any;
		return {
			text: text || undefined,
			toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
			finishReason: mapFinishReason(response.stop_reason),
			usage: {
				promptTokens:
					(usage?.input_tokens ?? 0) +
					(usage?.cache_read_input_tokens ?? 0) +
					(usage?.cache_creation_input_tokens ?? 0),
				completionTokens: usage?.output_tokens ?? 0,
			},
			rawCall: { rawPrompt: body.messages, rawSettings: { model: body.model, max_tokens: body.max_tokens } },
			response: { id: response.id, modelId: response.model },
			warnings,
		};
	}

	async doStream(_options: LanguageModelV1CallOptions): Promise<any> {
		throw new Error("Streaming is not used by the bot and not implemented for AnthropicChatModel");
	}
}

export function createAnthropicModel(modelId: string = ANTHROPIC_MODEL): AnthropicChatModel {
	return new AnthropicChatModel(modelId);
}
