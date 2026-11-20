import { describe, expect, it, test } from "bun:test";
import { detectConversationLanguage, detectStatusLanguage, isButtonPayload } from "../status";

describe("detectStatusLanguage", () => {
	it("should detect English by default", () => {
		expect(detectStatusLanguage("Check my movies")).toBe("en");
		expect(detectStatusLanguage("")).toBe("en");
		expect(detectStatusLanguage(null)).toBe("en");
	});

	it("should detect Spanish with strong diacritics", () => {
		expect(detectStatusLanguage("¿Puedes buscar una película?")).toBe("es");
		expect(detectStatusLanguage("película")).toBe("es");
	});

	it("should detect Spanish with common words even in short sentences", () => {
		// High frequency Spanish words added in v4.2.1
		expect(detectStatusLanguage("recomiéndame comedias")).toBe("es");
		expect(detectStatusLanguage("de que trata esto")).toBe("es");
		expect(detectStatusLanguage("no quiero eso")).toBe("es");
	});

	it("should return English for mixed but primarily English messages", () => {
		expect(detectStatusLanguage("Search for a movie called La Casa")).toBe(
			"en",
		);
	});
});

describe("detectConversationLanguage", () => {
	const { detectConversationLanguage } = require("../status");

	it("keeps Spanish for a list pick, a callback or a bare title", () => {
		const recent = ["recomendame películas de terror por favor"];
		expect(detectConversationLanguage("2", recent)).toBe("es");
		expect(detectConversationLanguage("notify_download_decline", recent)).toBe("es");
		expect(detectConversationLanguage("Parasite", recent)).toBe("es");
	});

	it("keeps English for the same messages in an English conversation", () => {
		expect(detectConversationLanguage("2", ["recommend me some horror movies"])).toBe("en");
	});

	it("treats a one-word Spanish greeting as Spanish", () => {
		expect(detectConversationLanguage("hola")).toBe("es");
		expect(detectConversationLanguage("gracias!")).toBe("es");
	});

	it("lets a full sentence decide for itself", () => {
		const recent = ["recomendame películas de terror por favor"];
		expect(detectConversationLanguage("what is in my download queue right now", recent)).toBe("en");
	});
});

describe("conversation language: colloquial Spanish and button payloads", () => {
	test("colloquial Rioplatense requests are Spanish", () => {
		expect(detectConversationLanguage("bajame dune parte dos", [])).toBe("es");
		expect(detectConversationLanguage("borra dune", [])).toBe("es");
	});

	test("English titles containing Spanish fragments stay English", () => {
		expect(detectConversationLanguage("add the departed", [])).toBe("en");
		expect(detectConversationLanguage("download dune part two", [])).toBe("en");
	});

	test("a button tap keeps the conversation's language", () => {
		const spanish = ["bajame dune parte dos"];
		expect(isButtonPayload("add movie 693134 4")).toBe(true);
		expect(detectConversationLanguage("add movie 693134 4", spanish)).toBe("es");
		expect(detectConversationLanguage("Remove the movie and delete the files", spanish)).toBe("es");
		expect(detectConversationLanguage("notify_download_decline", spanish)).toBe("es");
		expect(detectConversationLanguage("add movie 693134 4", ["add dune please now"])).toBe("en");
		expect(isButtonPayload("add the departed")).toBe(false);
	});
});
