import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import * as ai from "ai";
import * as database from "../../services/database";
import { processUserMessage } from "../index";
import { shouldRewriteForTargetLanguage } from "../utils";

describe("shouldRewriteForTargetLanguage, English conversation", () => {
	it("leaves an English reply alone when its only Spanish signals are names and titles", () => {
		expect(
			shouldRewriteForTargetLanguage(
				"Here are two films you might like: **Amélie (2001)** and **El Camino (2019)**. Both are in your library and ready to watch.",
				"en",
			),
		).toBe(false);
		expect(
			shouldRewriteForTargetLanguage(
				"It was directed by Alfonso Cuarón and it is already in your library, so there is nothing to download.",
				"en",
			),
		).toBe(false);
		expect(
			shouldRewriteForTargetLanguage(
				"I found La La Land and Los Olvidados in your library, and both of them are ready to watch on Plex.",
				"en",
			),
		).toBe(false);
	});

	it("still rewrites a Spanish reply", () => {
		expect(
			shouldRewriteForTargetLanguage(
				"¡Listo! Agregué **Dune (2021)** a Radarr y ya empezó la búsqueda.",
				"en",
			),
		).toBe(true);
		expect(
			shouldRewriteForTargetLanguage(
				"Ya está en tu biblioteca, así que no hace falta descargarla.",
				"en",
			),
		).toBe(true);
	});

	it("still rewrites a Spanish reply that lists English titles", () => {
		expect(
			shouldRewriteForTargetLanguage(
				"Te recomiendo The Lord of the Rings y The Last of Us, las dos están en tu biblioteca.",
				"en",
			),
		).toBe(true);
	});

	it("falls back to the signal detector when there is too little prose to judge", () => {
		expect(shouldRewriteForTargetLanguage("Done! **Amélie (2001)** added.", "en")).toBe(true);
		expect(shouldRewriteForTargetLanguage("Done! **Dune (2021)** added.", "en")).toBe(false);
	});
});

describe("shouldRewriteForTargetLanguage, Spanish conversation", () => {
	it("is unchanged: an English reply is rewritten unless it carries a Spanish signal", () => {
		expect(shouldRewriteForTargetLanguage("I added Dune to Radarr.", "es")).toBe(true);
		expect(
			shouldRewriteForTargetLanguage("I added **Café Society (2016)** to Radarr.", "es"),
		).toBe(false);
		expect(
			shouldRewriteForTargetLanguage("Ya está en tu biblioteca.", "es"),
		).toBe(false);
	});
});

let mockHistoryVal: any[] = [];
const mockGenerateText = mock();
const spies: any[] = [];
const savedEnv: Record<string, string | undefined> = {};

function reply(text: string) {
	return {
		text,
		toolCalls: [],
		toolResults: [],
		response: {
			messages: [{ role: "assistant", content: [{ type: "text", text }] }],
		},
	};
}

describe("the rewrite request in the agent loop", () => {
	beforeAll(() => {
		for (const key of ["AI_PROVIDER", "AI_MODEL_FAST", "AI_MODEL_CAPABLE"]) {
			savedEnv[key] = process.env[key];
		}
		spies.push(
			spyOn(database, "getHistory").mockImplementation(() => mockHistoryVal),
		);
		spies.push(
			spyOn(database, "saveHistory").mockImplementation(
				(_userId: number, history: any[]) => {
					mockHistoryVal = history;
				},
			),
		);
		spies.push(spyOn(database, "getUserName").mockImplementation(() => "Fran"));
		spies.push(
			spyOn(ai, "generateText").mockImplementation(mockGenerateText as any),
		);
	});

	afterAll(() => {
		for (const spy of spies) spy.mockRestore();
		for (const [key, value] of Object.entries(savedEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	beforeEach(() => {
		mockGenerateText.mockReset();
		mockHistoryVal = [];
		process.env.AI_PROVIDER = "google";
		process.env.AI_MODEL_FAST = "fast-model";
		process.env.AI_MODEL_CAPABLE = "capable-model";
	});

	it("is not sent for an English reply that contains a word like timestamps", async () => {
		const text = "Sonarr is online. Its log has no timestamps for the last import.";
		mockGenerateText.mockResolvedValueOnce(reply(text));

		const result = await processUserMessage(55571, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(result.text).toBe(text);
	});

	it("is not sent for an English reply that names an accented title", async () => {
		const text =
			"Sonarr is online and the queue is empty. The last import was Amélie, and it is in your library.";
		mockGenerateText.mockResolvedValueOnce(reply(text));

		const result = await processUserMessage(55572, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(result.text).toBe(text);
	});

	it("is still sent for a Spanish reply in an English conversation", async () => {
		mockGenerateText.mockResolvedValueOnce(
			reply("Sonarr está en línea y la cola está vacía."),
		);
		mockGenerateText.mockResolvedValueOnce({
			text: "Sonarr is online and the queue is empty.",
		});

		const result = await processUserMessage(55573, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(2);
		expect(result.text).toBe("Sonarr is online and the queue is empty.");
	});
});
