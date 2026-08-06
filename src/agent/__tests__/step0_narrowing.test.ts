import {
	afterAll,
	afterEach,
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
import * as mediaToolsClient from "../../services/media-tools-client";
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

describe("Step 0 — Ollama intent narrowing feeds the real Step 1 tool loop", () => {
	let classifySpy: ReturnType<typeof spyOn> | undefined;

	beforeEach(() => {
		mockGenerateText.mockClear();
		mockHistoryVal = [];
		process.env.AI_PROVIDER = "google";
		process.env.AI_MODEL_FAST = "fast-model";
		process.env.AI_MODEL_CAPABLE = "capable-model";
	});

	afterEach(() => {
		classifySpy?.mockRestore();
		classifySpy = undefined;
	});

	it("narrows Step 1's tool set to service-health tools on a confident match", async () => {
		classifySpy = spyOn(mediaToolsClient, "classifyIntent").mockResolvedValue({
			domain: "service-health",
			confidence: 0.9,
		});
		mockNoToolCallResponse("Sonarr is online.");

		await processUserMessage(11111, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		const toolsArg = mockGenerateText.mock.calls[0][0].tools;
		expect(Object.keys(toolsArg).sort()).toEqual(["checkServiceHealth", "getDiskSpace"]);
	});

	it("uses the full tool set when Step 0 fails open (classifier error)", async () => {
		classifySpy = spyOn(mediaToolsClient, "classifyIntent").mockRejectedValue(
			new Error("Ollama unreachable"),
		);
		mockNoToolCallResponse("Sure, here's what I found.");

		await processUserMessage(22222, "what's on my watchlist?");

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		const toolsArg = mockGenerateText.mock.calls[0][0].tools;
		// Full set includes many more tools than either pilot domain alone.
		expect(Object.keys(toolsArg).length).toBeGreaterThan(10);
		expect(toolsArg.searchMovie).toBeDefined();
		expect(toolsArg.checkServiceHealth).toBeDefined();
	});
});
