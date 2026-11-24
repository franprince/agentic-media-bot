import { afterAll, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as ai from "ai";
import * as database from "../../services/database";
import { processUserMessage } from "../index";
import { ALL_GROUPS, TOOL_GROUPS } from "../toolRouter";

let mockHistoryVal: any[] = [];
const mockGenerateText = mock();
const spies: any[] = [];
const savedEnv: Record<string, string | undefined> = {};
const EVERY_TOOL = new Set(ALL_GROUPS.flatMap((group) => TOOL_GROUPS[group]));

beforeAll(() => {
	for (const key of ["AI_PROVIDER", "AI_MODEL_FAST", "AI_MODEL_CAPABLE"]) savedEnv[key] = process.env[key];
	spies.push(
		spyOn(database, "getHistory").mockImplementation(() => mockHistoryVal),
		spyOn(database, "saveHistory").mockImplementation((_userId: number, history: any[]) => {
			mockHistoryVal = history;
		}),
		spyOn(database, "getUserName").mockImplementation(() => "Tester"),
		spyOn(database, "getConversationUpdatedAt").mockImplementation(() => Date.now()),
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
		response: { messages: [{ role: "assistant", content: [{ type: "text", text }] }] },
	};
}

/** Requests of the tool loop, not the classifier or the language rewrite. */
function loopRequests(): any[] {
	return mockGenerateText.mock.calls.map((call: any[]) => call[0]).filter((params: any) => params.tools);
}

function useProvider(provider: string) {
	process.env.AI_PROVIDER = provider;
	process.env.AI_MODEL_FAST = provider === "anthropic" ? "claude-haiku-5-5" : "fast-model";
	process.env.AI_MODEL_CAPABLE = provider === "anthropic" ? "claude-haiku-5-5" : "capable-model";
}

describe("with Claude, every request carries every tool", () => {
	beforeEach(() => {
		mockGenerateText.mockReset();
		mockGenerateText.mockResolvedValue(reply("Listo, ya está."));
		mockHistoryVal = [];
		useProvider("anthropic");
	});

	it("sends all tools without asking a classifier first", async () => {
		await processUserMessage(81001, "please do the usual thing with that one from before tonight");

		const requests = loopRequests();
		expect(requests).toHaveLength(1);
		expect(new Set(Object.keys(requests[0].tools))).toEqual(EVERY_TOOL);
		expect(mockGenerateText.mock.calls.some((call: any[]) => String(call[0].system ?? "").includes("You route a message"))).toBe(false);
	});

	it("sends all tools for a message whose keywords would have narrowed them", async () => {
		await processUserMessage(81002, "pause all torrents");

		expect(new Set(Object.keys(loopRequests()[0].tools))).toEqual(EVERY_TOOL);
	});

	it("keeps the add tools on a request for details", async () => {
		await processUserMessage(81003, "dame más detalles de Sunset Harbor");

		const tools = Object.keys(loopRequests()[0].tools);
		expect(tools).toContain("addMovie");
		expect(tools).toContain("addSeries");
	});

	it("keeps the user, date and language out of the system prompt and in a first system message", async () => {
		await processUserMessage(81004, "pause all torrents");

		const [request] = loopRequests();
		expect(request.system).not.toContain("User ID");
		expect(request.system).not.toContain("This conversation is in");
		expect(request.system).toContain("UNSUPPORTED");
		expect(request.system).not.toContain("NEED_MORE_TOOLS");
		expect(request.messages[0].role).toBe("system");
		expect(request.messages[0].content).toContain("User ID 81004");
		expect(request.messages[0].content).toContain("This conversation is in English");
		expect(request.messages[1]).toEqual({ role: "user", content: "pause all torrents" });
	});

	it("sends the same system prompt and tools when the language changes", async () => {
		await processUserMessage(81005, "qué películas nuevas hay para ver");
		await processUserMessage(81005, "and what about series, any new ones");

		const [first, second] = loopRequests();
		expect(second.system).toBe(first.system);
		expect(Object.keys(second.tools)).toEqual(Object.keys(first.tools));
		expect(first.messages[0].content).toContain("This conversation is in Spanish");
		expect(second.messages[0].content).toContain("This conversation is in English");
	});

	it("does not ask again when every tool was already offered", async () => {
		mockGenerateText.mockImplementationOnce(async (params: any) => {
			throw new ai.NoSuchToolError({ toolName: "madeUpTool", availableTools: Object.keys(params.tools) });
		});

		const result = await processUserMessage(81006, "pause all torrents");

		expect(loopRequests()).toHaveLength(1);
		expect(result.text).toBe("Sorry, I encountered an error while trying to process your request.");
	});
});

describe("other providers keep routing", () => {
	beforeEach(() => {
		mockGenerateText.mockReset();
		mockHistoryVal = [];
		useProvider("google");
	});

	it("still narrows a download request and drops the add tools on a details request", async () => {
		mockGenerateText.mockResolvedValue(reply("Done."));
		await processUserMessage(82001, "pause all torrents");
		await processUserMessage(82002, "dame más detalles de la película Sunset Harbor");

		const [downloads, details] = loopRequests();
		expect(Object.keys(downloads.tools).length).toBeLessThan(EVERY_TOOL.size);
		expect(Object.keys(details.tools)).not.toContain("addMovie");
		expect(downloads.system).toContain("This conversation is in English");
	});

	it("still asks the classifier about a message without keywords", async () => {
		mockGenerateText.mockResolvedValueOnce({ text: "system", toolCalls: [], toolResults: [] });
		mockGenerateText.mockResolvedValue(reply("Done."));

		await processUserMessage(82003, "please do the usual thing with that one from before tonight");

		expect(mockGenerateText.mock.calls[0][0].system).toContain("You route a message");
	});
});
