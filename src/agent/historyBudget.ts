import type { CoreMessage } from "ai";

/**
 * Shapes the stored conversation into what is sent to the model.
 *
 * The stored history is left untouched; this only builds a cheaper *view*:
 *   - older tool results are compacted to the fields later turns rely on
 *     (IDs, titles, years, counts) — long synopses and image URLs are dropped;
 *   - whole old turns are dropped, oldest first, until the view fits a budget;
 *   - the view always starts at a user message, so a tool result is never sent
 *     without the assistant tool call that produced it.
 */

/**
 * ~4 characters per token; the default keeps history near 1k tokens.
 * Override with AI_HISTORY_CHAR_BUDGET (providers without a tokens-per-minute
 * cap can afford more context).
 */
const configuredBudget = Number(process.env.AI_HISTORY_CHAR_BUDGET);
export const DEFAULT_HISTORY_CHAR_BUDGET =
	Number.isFinite(configuredBudget) && configuredBudget > 0
		? configuredBudget
		: 4000;

const DROPPED_KEYS = new Set([
	"overview",
	"summary",
	"plot",
	"posterUrl",
	"poster",
	"thumb",
	"art",
	"images",
	"remotePoster",
]);
const MAX_OLD_STRING_LENGTH = 160;
const MAX_OLD_ARRAY_ITEMS = 12;

/** Recursively strips bulky fields from an old tool result. */
export function compactToolResult(value: any): any {
	if (typeof value === "string") {
		return value.length > MAX_OLD_STRING_LENGTH
			? `${value.slice(0, MAX_OLD_STRING_LENGTH)}…`
			: value;
	}
	if (Array.isArray(value)) {
		const items = value.slice(0, MAX_OLD_ARRAY_ITEMS).map(compactToolResult);
		if (value.length > MAX_OLD_ARRAY_ITEMS) {
			items.push(`… ${value.length - MAX_OLD_ARRAY_ITEMS} more omitted`);
		}
		return items;
	}
	if (value && typeof value === "object") {
		const compacted: Record<string, any> = {};
		for (const [key, inner] of Object.entries(value)) {
			if (DROPPED_KEYS.has(key)) continue;
			compacted[key] = compactToolResult(inner);
		}
		return compacted;
	}
	return value;
}

function compactMessage(message: CoreMessage): CoreMessage {
	if (message.role !== "tool" || !Array.isArray(message.content)) {
		return message;
	}
	return {
		...message,
		content: message.content.map((part: any) =>
			part?.type === "tool-result"
				? { ...part, result: compactToolResult(part.result) }
				: part,
		),
	} as CoreMessage;
}

function sizeOf(messages: CoreMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total +=
			typeof message.content === "string"
				? message.content.length
				: JSON.stringify(message.content).length;
	}
	return total;
}

/** Splits history into turns, each starting at a user message. */
export function splitIntoTurns(history: CoreMessage[]): CoreMessage[][] {
	const turns: CoreMessage[][] = [];
	for (const message of history) {
		const current = turns[turns.length - 1];
		if (message.role === "user" || !current) {
			// Messages before the first user message (an orphaned tail left by an
			// earlier count-based trim) are dropped: they cannot be sent safely.
			if (message.role === "user") turns.push([message]);
			continue;
		}
		current.push(message);
	}
	return turns;
}

/**
 * Returns the messages to send to the model.
 * The latest turn (the message being answered) is always kept, uncompacted.
 */
export function prepareHistoryForModel(
	history: CoreMessage[],
	charBudget: number = DEFAULT_HISTORY_CHAR_BUDGET,
): CoreMessage[] {
	const turns = splitIntoTurns(history);
	if (turns.length === 0) return history.filter((m) => m.role === "user");

	const latest = turns[turns.length - 1] as CoreMessage[];
	const kept: CoreMessage[][] = [latest];
	let used = sizeOf(latest);

	for (let i = turns.length - 2; i >= 0; i--) {
		const compacted = (turns[i] as CoreMessage[]).map(compactMessage);
		const size = sizeOf(compacted);
		if (used + size > charBudget) break;
		kept.unshift(compacted);
		used += size;
	}

	return kept.flat();
}
