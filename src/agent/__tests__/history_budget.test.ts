import { describe, expect, it } from "bun:test";
import type { CoreMessage } from "ai";
import {
	CLAUDE_HISTORY_CHAR_BUDGET,
	compactToolResult,
	prepareHistoryForModel,
	splitIntoTurns,
} from "../historyBudget";

const LONG = "x".repeat(900);

function searchTurn(userText: string): CoreMessage[] {
	return [
		{ role: "user", content: userText },
		{
			role: "assistant",
			content: [{ type: "tool-call", toolCallId: "c1", toolName: "searchMovie", args: { term: userText } }],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "c1",
					toolName: "searchMovie",
					result: [{ title: "Dune", year: 2021, tmdbId: 438631, overview: LONG, posterUrl: "http://x/p.jpg" }],
				},
			],
		},
		{ role: "assistant", content: [{ type: "text", text: "Found Dune (2021)." }] },
	] as CoreMessage[];
}

describe("compactToolResult", () => {
	it("keeps identifiers and drops bulky fields", () => {
		const compacted = compactToolResult({ title: "Dune", tmdbId: 1, overview: LONG, posterUrl: "u", nested: [{ ratingKey: "9", summary: LONG }] });
		expect(compacted).toEqual({ title: "Dune", tmdbId: 1, nested: [{ ratingKey: "9" }] });
	});

	it("truncates long strings and long arrays", () => {
		expect(compactToolResult(LONG).length).toBeLessThan(170);
		const list = compactToolResult(Array.from({ length: 30 }, (_, i) => ({ id: i })));
		expect(list.length).toBe(13);
		expect(list[12]).toContain("18 more");
	});
});

describe("prepareHistoryForModel", () => {
	it("keeps the latest turn untouched and compacts older tool results", () => {
		const history = [...searchTurn("dune"), ...searchTurn("dune again")];
		const view = prepareHistoryForModel(history, 100_000);
		const older = (view[2] as any).content[0].result[0];
		const latest = (view[6] as any).content[0].result[0];
		expect(older).toEqual({ title: "Dune", year: 2021, tmdbId: 438631 });
		expect(latest.overview).toBe(LONG);
	});

	it("does not modify the stored history", () => {
		const history = [...searchTurn("dune"), { role: "user", content: "1" }] as CoreMessage[];
		prepareHistoryForModel(history, 100_000);
		expect((history[2] as any).content[0].result[0].overview).toBe(LONG);
	});

	it("drops the oldest turns first when over budget", () => {
		const history = [...searchTurn("first"), ...searchTurn("second"), { role: "user", content: "1" }] as CoreMessage[];
		const view = prepareHistoryForModel(history, 400);
		expect(view[0]).toEqual({ role: "user", content: "second" });
		expect(view.length).toBe(5);
		expect(view[view.length - 1]).toEqual({ role: "user", content: "1" });
	});

	it("always keeps the turn before the latest, so a pick still has its list", () => {
		const list = { role: "assistant", content: [{ type: "text", text: `1. Dune\n2. Ran\n${LONG}` }] };
		const history = [{ role: "user", content: "buscá" }, list, { role: "user", content: "2" }] as CoreMessage[];
		const view = prepareHistoryForModel(history, 50);
		expect(view).toEqual(history);
	});

	it("always keeps the latest turn, even if it alone exceeds the budget", () => {
		const view = prepareHistoryForModel(searchTurn("dune"), 10);
		expect(view.length).toBe(4);
	});

	it("never starts with an orphaned tool result", () => {
		const orphaned = searchTurn("dune").slice(2);
		const view = prepareHistoryForModel([...orphaned, { role: "user", content: "hola" }] as CoreMessage[]);
		expect(view).toEqual([{ role: "user", content: "hola" }]);
		expect(splitIntoTurns(orphaned as CoreMessage[])).toEqual([]);
	});
});

/**
 * Four turns shaped like a conversation that went wrong: a recommendation, a
 * library check, a synopsis from a search, then a new message about it.
 */
function fourTurnConversation(): CoreMessage[] {
	return [
		{ role: "user", content: "recomendame algo de ciencia ficción" },
		{ role: "assistant", content: [{ type: "text", text: `1. Dune\n2. Arrival\n${LONG}` }] },

		{ role: "user", content: "quiero ver Dune, ¿la tengo?" },
		{
			role: "assistant",
			content: [{ type: "tool-call", toolCallId: "c2", toolName: "searchPlexByTitleOnly", args: { title: "Dune" } }],
		},
		{
			role: "tool",
			content: [{ type: "tool-result", toolCallId: "c2", toolName: "searchPlexByTitleOnly", result: { totalFound: 0 } }],
		},
		{ role: "assistant", content: [{ type: "text", text: `No está en tu biblioteca. ${LONG}` }] },

		{ role: "user", content: "¿de qué trata?" },
		{
			role: "assistant",
			content: [{ type: "tool-call", toolCallId: "c3", toolName: "searchMovie", args: { term: "Dune" } }],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: "c3",
					toolName: "searchMovie",
					result: [{ title: "Dune", year: 2021, tmdbId: 438631, overview: LONG, posterUrl: "http://x/dune.jpg" }],
				},
			],
		},
		{ role: "assistant", content: [{ type: "text", text: `Dune (2021)\n\n${LONG}` }] },

		{ role: "user", content: "agregala" },
	] as CoreMessage[];
}

describe("history view profiles", () => {
	it("default view: unchanged — two turns, the previous search result compacted", () => {
		const view = prepareHistoryForModel(fourTurnConversation(), 2000);
		const expected = [
			{ role: "user", content: "¿de qué trata?" },
			{
				role: "assistant",
				content: [{ type: "tool-call", toolCallId: "c3", toolName: "searchMovie", args: { term: "Dune" } }],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "c3",
						toolName: "searchMovie",
						result: [{ title: "Dune", year: 2021, tmdbId: 438631 }],
					},
				],
			},
			{ role: "assistant", content: [{ type: "text", text: `Dune (2021)\n\n${LONG}` }] },
			{ role: "user", content: "agregala" },
		];
		expect(JSON.stringify(view)).toBe(JSON.stringify(expected));
	});

	it("Claude view: every recent turn as it happened, synopsis and poster included", () => {
		const history = fourTurnConversation();
		const view = prepareHistoryForModel(history, CLAUDE_HISTORY_CHAR_BUDGET, { compactOlderTurns: false });
		expect(JSON.stringify(view)).toBe(JSON.stringify(history));
		const previousResult = (view[8] as any).content[0].result[0];
		expect(previousResult.overview).toBe(LONG);
		expect(previousResult.posterUrl).toBe("http://x/dune.jpg");
		expect(view[0]).toEqual({ role: "user", content: "recomendame algo de ciencia ficción" });
	});

	it("Claude view: still drops an oversized old turn, and keeps the previous turn whole", () => {
		const oversized = [
			{ role: "user", content: "listá todo" },
			{ role: "assistant", content: [{ type: "text", text: "y".repeat(CLAUDE_HISTORY_CHAR_BUDGET + 1) }] },
		] as CoreMessage[];
		const history = [...oversized, ...searchTurn("dune"), { role: "user", content: "1" }] as CoreMessage[];
		const view = prepareHistoryForModel(history, CLAUDE_HISTORY_CHAR_BUDGET, { compactOlderTurns: false });
		expect(view[0]).toEqual({ role: "user", content: "dune" });
		expect((view[2] as any).content[0].result[0].overview).toBe(LONG);

		const previousIsOversized = [...oversized, { role: "user", content: "1" }] as CoreMessage[];
		expect(
			prepareHistoryForModel(previousIsOversized, CLAUDE_HISTORY_CHAR_BUDGET, { compactOlderTurns: false }),
		).toEqual(previousIsOversized);
	});

	it("the ceiling for Claude is 60,000 characters", () => {
		expect(CLAUDE_HISTORY_CHAR_BUDGET).toBe(60_000);
	});
});
