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

const SYNOPSIS = `SYNOPSIS ${"x".repeat(900)}`;

let mockHistoryVal: any[] = [];
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
