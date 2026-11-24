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
import * as confirmGuard from "../confirmGuard";
import { processUserMessage } from "../index";
import * as toolRouter from "../toolRouter";

const SYNOPSIS = `SYNOPSIS ${"x".repeat(900)}`;

const HOUR = 60 * 60 * 1000;

let mockHistoryVal: any[] = [];
let mockUpdatedAt: number | null = null;
let clearSpy: any;
let timestampSpy: any;
let routeSpy: any;
let guardSpy: any;
const mockGenerateText = mock();
const spies: any[] = [];
const savedEnv: Record<string, string | undefined> = {};

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
	clearSpy = spyOn(database, "clearHistory").mockImplementation(() => {
		mockHistoryVal = [];
	});
	timestampSpy = spyOn(database, "getConversationUpdatedAt").mockImplementation(
		() => mockUpdatedAt,
	);
	routeSpy = spyOn(toolRouter, "selectToolGroups");
	guardSpy = spyOn(confirmGuard, "guardConfirmations");
	spies.push(clearSpy, timestampSpy, routeSpy, guardSpy);
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

function searchTurn(id: string, userText: string, title: string): any[] {
	return [
		{ role: "user", content: userText },
		{
			role: "assistant",
			content: [{ type: "tool-call", toolCallId: id, toolName: "searchMovie", args: { term: title } }],
		},
		{
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId: id,
					toolName: "searchMovie",
					result: [{ title, year: 2021, tmdbId: 1, overview: SYNOPSIS, posterUrl: "http://x/p.jpg" }],
				},
			],
		},
		{ role: "assistant", content: [{ type: "text", text: `Encontré ${title}.` }] },
	];
}

function useProvider(provider: string) {
	process.env.AI_PROVIDER = provider;
	process.env.AI_MODEL_FAST = "fast-model";
	process.env.AI_MODEL_CAPABLE = "capable-model";
}

describe("history view per provider", () => {
	beforeEach(() => {
		mockGenerateText.mockReset();
		mockUpdatedAt = Date.now();
		mockHistoryVal = [
			...searchTurn("c1", "buscá la película Ran", "Ran"),
			...searchTurn("c2", "buscá la película Dune", "Dune"),
		];
	});

	it("sends Claude the earlier turns as they happened", async () => {
		useProvider("anthropic");
		mockGenerateText.mockResolvedValueOnce(reply("Listo."));

		await processUserMessage(66661, "agregá la película Dune");

		const sent = mockGenerateText.mock.calls[0][0].messages;
		expect(sent.length).toBe(9);
		expect(sent[0]).toEqual({ role: "user", content: "buscá la película Ran" });
		expect(sent[2].content[0].result[0].overview).toBe(SYNOPSIS);
		expect(sent[6].content[0].result[0].posterUrl).toBe("http://x/p.jpg");
	});

	it("keeps the compacted view for the other providers", async () => {
		useProvider("google");
		mockGenerateText.mockResolvedValueOnce(reply("Listo."));

		await processUserMessage(66662, "agregá la película Dune");

		const sent = mockGenerateText.mock.calls[0][0].messages;
		expect(JSON.stringify(sent)).not.toContain("SYNOPSIS");
		expect(JSON.stringify(sent)).not.toContain("posterUrl");
		expect(sent[sent.length - 1]).toEqual({ role: "user", content: "agregá la película Dune" });
	});
});

describe("session gap", () => {
	const NEW_MESSAGE = "agregá la película Dune";

	function storedTurns(count: number): any[] {
		return Array.from({ length: count }, (_, i) =>
			searchTurn(`c${i}`, `buscá la película número ${i}`, `Movie ${i}`),
		).flat();
	}

	beforeEach(() => {
		mockGenerateText.mockReset();
		mockGenerateText.mockResolvedValue(reply("Listo."));
		clearSpy.mockClear();
		timestampSpy.mockClear();
		routeSpy.mockClear();
		guardSpy.mockClear();
		mockHistoryVal = storedTurns(2);
		mockUpdatedAt = Date.now() - 13 * HOUR;
		useProvider("anthropic");
	});

	it("starts a new conversation on Claude for a typed message after more than 12 hours", async () => {
		mockHistoryVal = storedTurns(6);
		expect(mockHistoryVal.length).toBe(24);

		await processUserMessage(77771, NEW_MESSAGE);

		expect(clearSpy).toHaveBeenCalledTimes(1);
		expect(clearSpy.mock.calls[0][0]).toBe(77771);
		expect(mockGenerateText.mock.calls[0][0].messages).toEqual([
			{ role: "user", content: NEW_MESSAGE },
		]);
		expect(routeSpy.mock.calls[0][1]).toEqual([]);
		expect(guardSpy.mock.calls[0][1]).toEqual([]);
		expect(mockHistoryVal).toEqual([
			{ role: "user", content: NEW_MESSAGE },
			{ role: "assistant", content: [{ type: "text", text: "Listo." }] },
		]);
	});

	it("treats a conversation with no recorded activity as expired", async () => {
		mockUpdatedAt = null;

		await processUserMessage(77772, NEW_MESSAGE);

		expect(clearSpy).toHaveBeenCalledTimes(1);
		expect(mockGenerateText.mock.calls[0][0].messages.length).toBe(1);
	});

	it("has nothing to clear for a user with no stored conversation", async () => {
		mockHistoryVal = [];
		mockUpdatedAt = null;

		await processUserMessage(77773, NEW_MESSAGE);

		expect(clearSpy).not.toHaveBeenCalled();
	});

	it("keeps the conversation for a button tap, whatever its age", async () => {
		await processUserMessage(77774, "add movie 1 4", undefined, { fromButton: true });

		expect(clearSpy).not.toHaveBeenCalled();
		const sent = mockGenerateText.mock.calls[0][0].messages;
		expect(sent[0]).toEqual({ role: "user", content: "buscá la película número 0" });
		expect(sent[sent.length - 1]).toEqual({ role: "user", content: "add movie 1 4" });
		expect(routeSpy.mock.calls[0][1].length).toBe(8);
		expect(guardSpy.mock.calls[0][1].length).toBe(8);
	});

	it("keeps the conversation for a typed message within 12 hours", async () => {
		mockUpdatedAt = Date.now() - 1 * HOUR;

		await processUserMessage(77775, NEW_MESSAGE);

		expect(clearSpy).not.toHaveBeenCalled();
		expect(mockGenerateText.mock.calls[0][0].messages.length).toBe(9);
	});

	it("never resets on the startup catch-up path, where the unanswered message is the conversation", async () => {
		mockHistoryVal = [...storedTurns(1), { role: "user", content: NEW_MESSAGE }];

		await processUserMessage(77776, undefined);

		expect(clearSpy).not.toHaveBeenCalled();
		expect(timestampSpy).not.toHaveBeenCalled();
		expect(mockGenerateText.mock.calls[0][0].messages.length).toBe(5);
	});

	it("leaves the other providers alone", async () => {
		useProvider("google");

		await processUserMessage(77777, NEW_MESSAGE);

		expect(clearSpy).not.toHaveBeenCalled();
		expect(timestampSpy).not.toHaveBeenCalled();
		expect(routeSpy.mock.calls[0][1].length).toBe(8);
	});
});
