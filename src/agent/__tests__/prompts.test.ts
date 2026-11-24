import { describe, expect, it } from "bun:test";
import {
	buildSystemPromptTemplate,
	DEFAULT_SYSTEM_PROMPT,
	fillSystemPrompt,
	fillSystemPromptParts,
} from "../prompts";
import { ALL_GROUPS } from "../toolRouter";

describe("buildSystemPromptTemplate", () => {
	it("always includes the core rules", () => {
		for (const groups of [[], ["downloads"], [...ALL_GROUPS]] as any[]) {
			const prompt = buildSystemPromptTemplate(groups);
			expect(prompt).toContain("NO MARKDOWN TABLES");
			expect(prompt).toContain("BUTTON: <Label> | <callback_data>");
			expect(prompt).toContain("Jellyfin is NOT supported");
		}
	});

	it("asks for the marker only while there are tools left to widen to", () => {
		for (const groups of [[], ["downloads"], ["movies", "series"]] as any[]) {
			const prompt = buildSystemPromptTemplate(groups);
			expect(prompt).toContain("reply with exactly NEED_MORE_TOOLS");
			expect(prompt).not.toContain("UNSUPPORTED");
		}
		const everything = buildSystemPromptTemplate([...ALL_GROUPS]);
		expect(everything).not.toContain("NEED_MORE_TOOLS");
		expect(everything).toContain("UNSUPPORTED");
		expect(everything).toContain("say so plainly in their language");
	});

	it("includes only the sections of the active groups", () => {
		const downloads = buildSystemPromptTemplate(["downloads"]);
		expect(downloads).not.toContain("CONFIRMATION PROTOCOL");
		expect(downloads).not.toContain("searchPlexByCountry");

		const movies = buildSystemPromptTemplate(["movies"]);
		expect(movies).toContain("CONFIRMATION PROTOCOL");
		expect(movies).toContain("TWO-STEP ADD/REMOVE");
		expect(movies).toContain("notify_download_confirm_");
		expect(movies).toContain("POSTER: <url>");
		expect(movies).not.toContain("discoverMedia");

		expect(buildSystemPromptTemplate(["library"])).toContain("searchPlexByDuration");
		expect(buildSystemPromptTemplate(["discovery"])).toContain("ALWAYS call 'discoverMedia'");
		expect(buildSystemPromptTemplate(["series"])).toContain("getUnwatchedEpisodes");
	});

	it("tells the model that a newer tool result replaces an older one", () => {
		for (const groups of [[], ["downloads"], [...ALL_GROUPS]] as any[]) {
			expect(buildSystemPromptTemplate(groups)).toContain("trust the newest one");
		}
	});

	it("tells the model how to read the library checks wherever their tools are offered", () => {
		for (const group of ["movies", "series"] as any[]) {
			expect(buildSystemPromptTemplate([group])).toContain("'alreadyInPlex' true means the user already has it");
		}
		expect(buildSystemPromptTemplate(["discovery"])).toContain("null means the check failed");
		expect(buildSystemPromptTemplate(["library"])).toContain("'alsoKnownAs'");
		expect(buildSystemPromptTemplate(["downloads"])).not.toContain("alreadyInPlex");
	});

	it("lists capabilities for small talk and for the full prompt only", () => {
		expect(buildSystemPromptTemplate([])).toContain("CAPABILITIES");
		expect(DEFAULT_SYSTEM_PROMPT).toContain("CAPABILITIES");
		expect(buildSystemPromptTemplate(["movies"])).not.toContain("CAPABILITIES");
	});

	it("is much smaller when narrowed", () => {
		expect(buildSystemPromptTemplate(["downloads"]).length).toBeLessThan(DEFAULT_SYSTEM_PROMPT.length / 3);
	});
});

describe("fillSystemPrompt", () => {
	it("replaces the context placeholders", () => {
		const prompt = fillSystemPrompt(DEFAULT_SYSTEM_PROMPT, { userId: 42, userName: "Fran", currentDate: "Saturday, November 14, 2026" });
		expect(prompt).toContain("User ID 42");
		expect(prompt).toContain("Name Fran");
		expect(prompt).toContain("November 14, 2026");
		expect(prompt).not.toContain("{{");
		expect(prompt).not.toContain("This conversation is in");
	});

	it("states the conversation language when known", () => {
		const context = { userId: 1, userName: "Fran", currentDate: "today" };
		expect(fillSystemPrompt("x", { ...context, language: "es" })).toContain("in Spanish");
		expect(fillSystemPrompt("x", { ...context, language: "en" })).toContain("in English");
	});
});

describe("fillSystemPromptParts", () => {
	const template = buildSystemPromptTemplate([...ALL_GROUPS]);
	const ana = { userId: 1, userName: "Ana", currentDate: "Monday, March 2, 2026", language: "es" as const };
	const bo = { userId: 2, userName: "Bo", currentDate: "Tuesday, March 3, 2026", language: "en" as const };

	it("keeps the fixed rules free of anything that changes per user, day or language", () => {
		const a = fillSystemPromptParts(template, ana);
		const b = fillSystemPromptParts(template, bo);
		expect(a.fixed).toBe(b.fixed);
		expect(a.fixed).not.toContain("{{");
		expect(a.fixed).not.toContain("Ana");
		expect(a.fixed).not.toContain("2026");
		expect(a.fixed).not.toContain("This conversation is in");
		expect(a.fixed).toContain("RULES:");
	});

	it("puts the user, the date and the language in the context part", () => {
		const { context } = fillSystemPromptParts(template, ana);
		expect(context).toContain("User ID 1");
		expect(context).toContain("Name Ana");
		expect(context).toContain("Today is Monday, March 2, 2026");
		expect(context).toContain("This conversation is in Spanish");
	});

	it("together carry the same text as the single prompt", () => {
		const { fixed, context } = fillSystemPromptParts(template, ana);
		const single = fillSystemPrompt(template, ana);
		for (const line of single.split("\n").filter((l) => l.trim())) {
			expect(`${fixed}\n${context}`).toContain(line.trim());
		}
	});
});
