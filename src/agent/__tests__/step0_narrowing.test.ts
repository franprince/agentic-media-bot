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

let mockHistoryVal: any[] = [];
const mockGenerateText = mock();
const spies: any[] = [];

beforeAll(() => {
	spies.push(
		spyOn(database, "getHistory").mockImplementation(() => mockHistoryVal),
	);
	spies.push(
		spyOn(database, "saveHistory").mockImplementation(
			(userId: number, history: any[]) => {
				mockHistoryVal = history;
			},
		),
	);
	spies.push(spyOn(database, "getUserName").mockImplementation(() => "Fran"));
	spies.push(
		spyOn(database, "savePendingNotification").mockImplementation(() => {}),
	);
	spies.push(
		spyOn(ai, "generateText").mockImplementation(mockGenerateText as any),
	);
});

afterAll(() => {
	for (const spy of spies) {
		spy.mockRestore();
	}
});

function mockNoToolCallResponse(text: string) {
	mockGenerateText.mockResolvedValueOnce({
		text,
		toolCalls: [],
		toolResults: [],
		response: { messages: [{ role: "assistant", content: [{ type: "text", text }] }] },
	});
}

function mockToolGroupClassifier(answer: string) {
	mockGenerateText.mockResolvedValueOnce({ text: answer, toolCalls: [], toolResults: [] });
}

describe("Step 0 — tool routing feeds the real Step 1 tool loop", () => {
	beforeEach(() => {
		mockGenerateText.mockReset();
		mockHistoryVal = [];
		process.env.AI_PROVIDER = "google";
		process.env.AI_MODEL_FAST = "fast-model";
		process.env.AI_MODEL_CAPABLE = "capable-model";
	});

	it("narrows Step 1's tool set from keywords, with no extra model call", async () => {
		mockNoToolCallResponse("Sonarr is online.");

		await processUserMessage(11111, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		const call = mockGenerateText.mock.calls[0][0];
		expect(Object.keys(call.tools).sort()).toEqual(["checkServiceHealth", "getDiskSpace"]);
		// Rules for tools that were not offered are left out of the prompt.
		expect(call.system).not.toContain("CONFIRMATION PROTOCOL");
	});

	it("sends no tools at all for small talk", async () => {
		mockNoToolCallResponse("Hello Fran!");

		await processUserMessage(11112, "hello!");

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(mockGenerateText.mock.calls[0][0].tools).toBeUndefined();
	});

	it("asks the classifier when keywords and context find nothing", async () => {
		mockToolGroupClassifier("movies, series");
		mockNoToolCallResponse("Found it.");

		await processUserMessage(22221, "Parasite");

		expect(mockGenerateText).toHaveBeenCalledTimes(2);
		const toolsArg = mockGenerateText.mock.calls[1][0].tools;
		expect(toolsArg.searchMovie).toBeDefined();
		expect(toolsArg.searchSeries).toBeDefined();
		expect(toolsArg.getTorrents).toBeUndefined();
	});

	it("uses the full tool set when the classifier fails (fail open)", async () => {
		mockGenerateText.mockRejectedValueOnce(new Error("LLM unreachable"));
		mockNoToolCallResponse("Sure, here's what I found.");

		await processUserMessage(22222, "Parasite");

		const toolsArg = mockGenerateText.mock.calls[1][0].tools;
		expect(Object.keys(toolsArg).length).toBeGreaterThan(30);
		expect(toolsArg.searchMovie).toBeDefined();
		expect(toolsArg.checkServiceHealth).toBeDefined();
		// Legacy aliases are no longer sent as duplicate schemas.
		expect(toolsArg.browsePlexByGenre).toBeUndefined();
		expect(toolsArg.findPlexByCountry).toBeUndefined();
	});

	it("widens the tool set when the narrowed model answers NEED_MORE_TOOLS", async () => {
		mockNoToolCallResponse("NEED_MORE_TOOLS");
		mockToolGroupClassifier("downloads");
		mockNoToolCallResponse("Your queue is empty.");

		const result = await processUserMessage(33333, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(3);
		const widened = mockGenerateText.mock.calls[2][0].tools;
		expect(widened.checkServiceHealth).toBeDefined();
		expect(widened.getTorrents).toBeDefined();
		expect(result.text).toBe("Your queue is empty.");
	});

	it("sends a budgeted view of the history, not the whole stored conversation", async () => {
		const bigResult = { overview: "x".repeat(5000), title: "Dune", tmdbId: 1 };
		for (let i = 0; i < 6; i++) {
			mockHistoryVal.push(
				{ role: "user", content: `buscá la película ${i}` },
				{ role: "assistant", content: [{ type: "tool-call", toolCallId: `c${i}`, toolName: "searchMovie", args: {} }] },
				{ role: "tool", content: [{ type: "tool-result", toolCallId: `c${i}`, toolName: "searchMovie", result: bigResult }] },
				{ role: "assistant", content: [{ type: "text", text: "x".repeat(1500) }] },
			);
		}
		mockNoToolCallResponse("Listo.");

		await processUserMessage(44444, "agregá la película Dune");

		const sent = mockGenerateText.mock.calls[0][0].messages;
		expect(JSON.stringify(sent).length).toBeLessThan(7000);
		expect(sent[0].role).toBe("user");
		expect(sent[sent.length - 1]).toEqual({ role: "user", content: "agregá la película Dune" });
		// The stored history keeps everything.
		expect(JSON.stringify(mockHistoryVal).length).toBeGreaterThan(30000);
	});
});
