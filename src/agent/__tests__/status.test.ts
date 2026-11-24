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

describe("Spanish that depends on inflected or doubled words", () => {
	it("recognises plural and enclitic forms of a listed word", () => {
		expect(detectStatusLanguage("buscame la ultima de Nolan")).toBe("es");
		expect(detectStatusLanguage("peliculas de terror")).toBe("es");
		expect(detectStatusLanguage("agregala a mi lista")).toBe("es");
		expect(detectStatusLanguage("faltantes de Marvel")).toBe("es");
	});

	it("recognises a longer message whose only listed word is tengo, esta or esto", () => {
		expect(detectStatusLanguage("tengo Breaking Bad completa?")).toBe("es");
		expect(detectStatusLanguage("esta serie termino?")).toBe("es");
		expect(detectStatusLanguage("esto sirve para algo?")).toBe("es");
		expect(detectConversationLanguage("tengo Breaking Bad completa?", [])).toBe("es");
	});

	it("recognises forms of estar and words that used to match inside another", () => {
		expect(detectStatusLanguage("estoy aburrido hoy")).toBe("es");
		expect(detectStatusLanguage("estan bajando ahora mismo?")).toBe("es");
		expect(detectStatusLanguage("estaba viendo Dune ayer")).toBe("es");
		expect(detectStatusLanguage("espero que ande")).toBe("es");
		expect(detectStatusLanguage("colas de descarga largas")).toBe("es");
		expect(detectStatusLanguage("la respuesta correcta")).toBe("es");
		expect(detectStatusLanguage("obtengo un error raro")).toBe("es");
	});
});

describe("English words that contain a Spanish word", () => {
	it("does not read them as Spanish", () => {
		expect(detectStatusLanguage("The log has no timestamps for that download")).toBe("en");
		expect(detectStatusLanguage("A long restaurant scene opens the film")).toBe("en");
		expect(detectStatusLanguage("It is a real estate drama")).toBe("en");
		expect(detectStatusLanguage("Nicolas Cage stars in this western")).toBe("en");
		expect(detectStatusLanguage("The Last Emperor was added yesterday")).toBe("en");
		expect(detectStatusLanguage("It is a 4K restoration and a milestone")).toBe("en");
	});

	it("keeps an English request English", () => {
		expect(detectConversationLanguage("show me the timestamps of my downloads", [])).toBe("en");
	});
});

describe("a request with no clear sign of either language", () => {
	const spanishConversation = ["qué películas nuevas hay", "dale, gracias"];
	const englishConversation = ["what movies came out this week", "thanks"];

	test("accent-less Rioplatense requests read as Spanish on their own", () => {
		expect(detectConversationLanguage("recomendame 4 pelis de terror", [])).toBe("es");
		expect(detectConversationLanguage("pasame series comicas cortas", [])).toBe("es");
		expect(detectConversationLanguage("quiero ver algo corto", [])).toBe("es");
		expect(detectConversationLanguage("tenes alguna serie nueva", [])).toBe("es");
		expect(detectStatusLanguage("recomendame 4 pelis de terror")).toBe("es");
	});

	test("without English words, the conversation decides", () => {
		expect(detectConversationLanguage("Sunset Harbor 2024 completa", spanishConversation)).toBe("es");
		expect(detectConversationLanguage("Sunset Harbor 2024 completa", englishConversation)).toBe("en");
	});

	test("a title-case title inside a Spanish request does not make it English", () => {
		expect(detectConversationLanguage("agrega The Garden of Stones", spanishConversation)).toBe("es");
		expect(detectConversationLanguage("busca The Last Lighthouse por favor", [])).toBe("es");
		expect(detectConversationLanguage("busca House of the Tides", [])).toBe("es");
		expect(detectConversationLanguage("agrega Return of the King of Ash", spanishConversation)).toBe("es");
	});

	test("an English request still reads as English in a Spanish conversation", () => {
		expect(detectConversationLanguage("I mean the other one", spanishConversation)).toBe("en");
		expect(detectConversationLanguage("recommend me 5 comedy series", spanishConversation)).toBe("en");
		expect(detectConversationLanguage("Is sonarr up right now", spanishConversation)).toBe("en");
		expect(detectConversationLanguage("The Garden of Stones is great, add it", spanishConversation)).toBe("en");
		expect(detectConversationLanguage("pause all torrents", spanishConversation)).toBe("en");
		expect(detectConversationLanguage("how much disk space is left", spanishConversation)).toBe("en");
	});

	test("words added for Spanish only count as whole words", () => {
		expect(detectConversationLanguage("the lateness of the comedian algorithm", [])).toBe("en");
	});
});

describe("the conversation language is the latest message that shows one", () => {
	const spanishThenEnglish = ["qué películas nuevas hay", "dale, gracias", "mostrame las descargas", "recommend me an old comedy film"];
	const englishThenSpanish = ["what movies came out this week", "thanks a lot", "show me the downloads", "recomendame una comedia vieja"];

	test("a button tap", () => {
		expect(detectConversationLanguage("pick_old_film", spanishThenEnglish)).toBe("en");
		expect(detectConversationLanguage("pick_old_film", englishThenSpanish)).toBe("es");
	});

	test("a number or a bare title", () => {
		expect(detectConversationLanguage("2", spanishThenEnglish)).toBe("en");
		expect(detectConversationLanguage("2", englishThenSpanish)).toBe("es");
		expect(detectConversationLanguage("Sunset Harbor 1984 completa", spanishThenEnglish)).toBe("en");
	});

	test("earlier button taps and unclear messages are skipped", () => {
		expect(detectConversationLanguage("2", [...englishThenSpanish, "add_movie_confirm", "Sunset Harbor"])).toBe("es");
	});
});
