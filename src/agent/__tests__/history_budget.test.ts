import { describe, expect, it } from "bun:test";
import type { CoreMessage } from "ai";
import {
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
		expect(view[view.length - 1]).toEqual({ role: "user", content: "1" });
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
