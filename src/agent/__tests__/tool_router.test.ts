import { describe, expect, it } from "bun:test";
import type { CoreMessage } from "ai";
import {
	ALL_GROUPS,
	contextGroups,
	isChatOnlyMessage,
	isFollowUpMessage,
	keywordGroups,
	pickToolsForGroups,
	selectToolGroups,
	TOOL_GROUPS,
} from "../toolRouter";

const sorted = (groups: Iterable<string>) => [...groups].sort();

function turnWithTool(userText: string, toolName: string): CoreMessage[] {
	return [
		{ role: "user", content: userText },
		{
			role: "assistant",
			content: [
				{ type: "tool-call", toolCallId: "c1", toolName, args: {} },
			],
		},
		{
			role: "tool",
			content: [
				{ type: "tool-result", toolCallId: "c1", toolName, result: {} },
			],
		},
		{ role: "assistant", content: [{ type: "text", text: "done" }] },
	] as CoreMessage[];
}

describe("keywordGroups", () => {
	it("routes Spanish and English requests to the same groups", () => {
		expect(sorted(keywordGroups("agregá la película Dune 2"))).toEqual(["movies"]);
		expect(sorted(keywordGroups("add the movie Dune 2"))).toEqual(["movies"]);
		expect(sorted(keywordGroups("cómo van las descargas?"))).toEqual(["downloads"]);
		expect(sorted(keywordGroups("pause all torrents"))).toEqual(["downloads"]);
	});

	it("offers both movies and series for an add request that names neither", () => {
		expect(sorted(keywordGroups("bajame Severance"))).toEqual(["movies", "series"]);
		expect(sorted(keywordGroups("download Severance"))).toEqual(["movies", "series"]);
	});

	it("ignores accents and case", () => {
		expect(sorted(keywordGroups("PELÍCULAS JAPONESAS"))).toEqual(["library", "movies"]);
	});

	it("covers library, discovery, system, watchlist, reports and ErsatzTV", () => {
		expect(keywordGroups("how many movies do I have?").has("library")).toBe(true);
		expect(keywordGroups("recomendame algo").has("discovery")).toBe(true);
		expect(sorted(keywordGroups("is sonarr up?"))).toEqual(["system"]);
		expect(keywordGroups("cuánto espacio en disco queda").has("system")).toBe(true);
		expect(keywordGroups("what's on my watchlist?").has("watchlist")).toBe(true);
		expect(keywordGroups("suscribime al reporte semanal").has("reports")).toBe(true);
		expect(keywordGroups("armá un canal de anime").has("ersatztv")).toBe(true);
	});

	it("finds nothing in a bare title", () => {
		expect(keywordGroups("Parasite").size).toBe(0);
	});
});

describe("message classification helpers", () => {
	it("recognises small talk", () => {
		expect(isChatOnlyMessage("Hola!")).toBe(true);
		expect(isChatOnlyMessage("muchas gracias")).toBe(true);
		expect(isChatOnlyMessage("what can you do?")).toBe(true);
		expect(isChatOnlyMessage("hola, tenés Dune?")).toBe(false);
	});

	it("recognises follow-ups: numbers, callbacks and short replies", () => {
		expect(isFollowUpMessage("4")).toBe(true);
		expect(isFollowUpMessage("notify_download_confirm_movie_693134")).toBe(true);
		expect(isFollowUpMessage("sí, dale")).toBe(true);
		expect(
			isFollowUpMessage("quiero que me cuentes todo lo que sabés sobre esta serie"),
		).toBe(false);
	});
});

describe("contextGroups", () => {
	it("returns the groups of the tools used in the previous turn", () => {
		expect(sorted(contextGroups(turnWithTool("recientes", "getRecentlyAddedPlex")))).toEqual(["library"]);
	});

	it("lets a pick from a recommendation list reach the add tools", () => {
		expect(sorted(contextGroups(turnWithTool("recomendame algo", "discoverMedia")))).toEqual(["discovery", "movies", "series"]);
	});

	it("maps legacy tool names", () => {
		expect(sorted(contextGroups(turnWithTool("japonesas", "findPlexByCountry")))).toEqual(["discovery", "library"]);
	});

	it("is empty when recent turns used no tools", () => {
		const history = [
			{ role: "user", content: "hola" },
			{ role: "assistant", content: [{ type: "text", text: "hola!" }] },
		] as CoreMessage[];
		expect(contextGroups(history).size).toBe(0);
	});
});

describe("selectToolGroups", () => {
	it("uses keywords without any model call", async () => {
		const decision = await selectToolGroups("cómo van las descargas?", []);
		expect(decision).toEqual({ groups: ["downloads"], source: "keyword", narrowed: true });
	});

	it("sends no tools for small talk", async () => {
		const decision = await selectToolGroups("hola!", []);
		expect(decision.groups).toEqual([]);
		expect(decision.source).toBe("chat");
	});

	it("inherits the previous turn's groups for a numbered pick", async () => {
		const decision = await selectToolGroups("2", turnWithTool("buscá Dune", "searchMovie"));
		expect(decision.source).toBe("context");
		expect(decision.groups).toEqual(["movies"]);
	});

	it("inherits context for a button callback and adds its own keywords", async () => {
		const decision = await selectToolGroups(
			"notify_download_confirm_series_413380",
			turnWithTool("agregá Severance", "addSeries"),
		);
		expect(decision.narrowed).toBe(true);
		expect(decision.groups).toContain("series");
	});

	it("keeps the add tools for a typed confirmation such as 'dale' or 'ok'", async () => {
		for (const reply of ["dale", "ok", "perfecto", "sí"]) {
			const decision = await selectToolGroups(reply, turnWithTool("agregá Dune", "addMovie"));
			expect(decision.source).toBe("context");
			expect(decision.groups).toContain("movies");
		}
	});

	it("offers recommendations after a library search (zero-results follow-up)", async () => {
		const decision = await selectToolGroups("sí", turnWithTool("pelis de Islandia", "searchPlexByCountry"));
		expect(decision.groups.sort()).toEqual(["discovery", "library"]);
	});

	it("falls back to every group when nothing matches and there is no classifier", async () => {
		const decision = await selectToolGroups("Parasite", []);
		expect(decision.narrowed).toBe(false);
		expect(sorted(decision.groups)).toEqual(sorted(ALL_GROUPS));
	});
});

describe("pickToolsForGroups", () => {
	it("returns only the tools of the requested groups", () => {
		const tools = { checkServiceHealth: 1, getDiskSpace: 2, searchMovie: 3 };
		expect(Object.keys(pickToolsForGroups(tools, ["system"])).sort()).toEqual(["checkServiceHealth", "getDiskSpace"]);
		expect(pickToolsForGroups(tools, [])).toEqual({});
	});

	it("every group only names tools that exist", async () => {
		const botTools: Record<string, any> = await import("../tools");
		const exportName: Record<string, string> = {
			searchPlexByGenre: "browsePlexByGenreTool",
			searchPlexByCountry: "findPlexByCountryTool",
		};
		for (const name of Object.values(TOOL_GROUPS).flat()) {
			expect(botTools[exportName[name] ?? `${name}Tool`]).toBeDefined();
		}
	});
});
