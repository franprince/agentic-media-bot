import { describe, expect, it } from "bun:test";
import {
	buildSystemPromptTemplate,
	DEFAULT_SYSTEM_PROMPT,
	fillSystemPrompt,
} from "../prompts";
import { ALL_GROUPS } from "../toolRouter";

describe("buildSystemPromptTemplate", () => {
	it("always includes the core rules", () => {
		for (const groups of [[], ["downloads"], [...ALL_GROUPS]] as any[]) {
			const prompt = buildSystemPromptTemplate(groups);
			expect(prompt).toContain("NO MARKDOWN TABLES");
			expect(prompt).toContain("BUTTON: <Label> | <callback_data>");
			expect(prompt).toContain("NEED_MORE_TOOLS");
			expect(prompt).toContain("Jellyfin is NOT supported");
		}
	});

	it("includes only the sections of the active groups", () => {
		const downloads = buildSystemPromptTemplate(["downloads"]);
		expect(downloads).not.toContain("CONFIRMATION PROTOCOL");
		expect(downloads).not.toContain("searchPlexByCountry");

		const movies = buildSystemPromptTemplate(["movies"]);
		expect(movies).toContain("CONFIRMATION PROTOCOL");
		expect(movies).toContain("notify_download_confirm_");
		expect(movies).toContain("POSTER: <url>");
		expect(movies).not.toContain("discoverMedia");

		expect(buildSystemPromptTemplate(["library"])).toContain("searchPlexByDuration");
		expect(buildSystemPromptTemplate(["discovery"])).toContain("ALWAYS call 'discoverMedia'");
		expect(buildSystemPromptTemplate(["series"])).toContain("getUnwatchedEpisodes");
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
	});
});
