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
import { noToolReply } from "../response";

const MARKER = "NEED_MORE_TOOLS";

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

/** Arguments of the n-th model request. */
function requestAt(index: number): any {
	return (mockGenerateText.mock.calls[index] as any[])[0];
}

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

function classifierAnswer(answer: string) {
	return { text: answer, toolCalls: [], toolResults: [] };
}

function lastSavedText(): string {
	const last = mockHistoryVal[mockHistoryVal.length - 1];
	return last.content[0].text;
}

describe("a request no tool covers", () => {
	beforeEach(() => {
		mockGenerateText.mockReset();
		mockHistoryVal = [];
		process.env.AI_PROVIDER = "google";
		process.env.AI_MODEL_FAST = "fast-model";
		process.env.AI_MODEL_CAPABLE = "capable-model";
	});

	it("gets a plain answer after one widening, and the marker rule is gone once every tool is offered", async () => {
		mockGenerateText.mockResolvedValueOnce(reply(MARKER));
		mockGenerateText.mockResolvedValueOnce(classifierAnswer("system"));
		mockGenerateText.mockResolvedValueOnce(reply(MARKER));

		const result = await processUserMessage(55551, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(3);
		const narrowed = requestAt(0);
		const widened = requestAt(2);
		expect(narrowed.system).toContain(MARKER);
		expect(Object.keys(widened.tools).length).toBeGreaterThan(30);
		expect(widened.system).not.toContain(MARKER);
		expect(widened.system).toContain("UNSUPPORTED");

		expect(result.text).toBe(noToolReply("en"));
		expect(JSON.stringify(mockHistoryVal)).not.toContain(MARKER);
		expect(lastSavedText()).toBe(noToolReply("en"));
	});

	it("answers in Spanish in a Spanish conversation", async () => {
		mockGenerateText.mockResolvedValueOnce(reply(MARKER));
		mockGenerateText.mockResolvedValueOnce(classifierAnswer("movies"));
		mockGenerateText.mockResolvedValueOnce(reply(MARKER));

		const result = await processUserMessage(
			55552,
			"cambiá la calidad de la película que ya tengo",
		);

		expect(result.text).toBe(noToolReply("es"));
		expect(lastSavedText()).toBe(noToolReply("es"));
	});

	it("does not leave punctuation behind when the marker comes with a full stop", async () => {
		mockGenerateText.mockResolvedValueOnce(reply(`${MARKER}.`));
		mockGenerateText.mockResolvedValueOnce(classifierAnswer("system"));
		mockGenerateText.mockResolvedValueOnce(reply(`${MARKER}.`));

		const result = await processUserMessage(55553, "is sonarr up?");

		expect(result.text).toBe(noToolReply("en"));
	});

	it("keeps the model's own words when it adds some to the marker", async () => {
		mockGenerateText.mockResolvedValueOnce(reply(MARKER));
		mockGenerateText.mockResolvedValueOnce(classifierAnswer("system"));
		mockGenerateText.mockResolvedValueOnce(
			reply(`${MARKER} I cannot change quality profiles.`),
		);

		const result = await processUserMessage(55554, "is sonarr up?");

		expect(result.text).toBe("I cannot change quality profiles.");
		expect(lastSavedText()).toBe("I cannot change quality profiles.");
		expect(JSON.stringify(mockHistoryVal)).not.toContain(MARKER);
	});

	it("keeps the generic text for an empty reply that never held the marker", async () => {
		mockGenerateText.mockResolvedValueOnce(reply(""));

		const result = await processUserMessage(55555, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(result.text).toBe("I had trouble formulating a response.");
	});
});

describe("the marker after a tool ran, with a separate synthesis model", () => {
	const toolCall = { type: "tool-call", toolCallId: "t1", toolName: "checkServiceHealth", args: {} };
	const toolResult = {
		role: "tool",
		content: [{ type: "tool-result", toolCallId: "t1", toolName: "checkServiceHealth", result: { sonarr: "online" } }],
	};

	function toolThenMarker() {
		return {
			text: MARKER,
			toolCalls: [],
			toolResults: [{ toolName: "checkServiceHealth", result: { sonarr: "online" } }],
			response: {
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "Checking Sonarr..." }, toolCall] },
					toolResult,
					{ role: "assistant", content: [{ type: "text", text: MARKER }] },
				],
			},
		};
	}

	beforeEach(() => {
		mockGenerateText.mockReset();
		mockHistoryVal = [];
		process.env.AI_PROVIDER = "google";
		process.env.AI_MODEL_FAST = "fast-model";
		process.env.AI_MODEL_CAPABLE = "capable-model";
	});

	it("keeps the marker out of the synthesis request and saves only what the user saw", async () => {
		mockGenerateText.mockResolvedValueOnce(toolThenMarker());
		mockGenerateText.mockResolvedValueOnce(reply("Sonarr is online."));

		const result = await processUserMessage(55561, "is sonarr up?");

		expect(mockGenerateText).toHaveBeenCalledTimes(2);
		const synthesisMessages = requestAt(1).messages;
		expect(JSON.stringify(synthesisMessages)).not.toContain(MARKER);
		expect(synthesisMessages[synthesisMessages.length - 1]).toEqual(toolResult);

		expect(result.text).toBe("Sonarr is online.");
		const saved = JSON.stringify(mockHistoryVal);
		expect(saved).not.toContain(MARKER);
		expect(saved).not.toContain(noToolReply("en"));
		expect(mockHistoryVal.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"assistant",
		]);
		expect(lastSavedText()).toBe("Sonarr is online.");
	});

	it("replaces a synthesis reply that is only the marker", async () => {
		mockGenerateText.mockResolvedValueOnce(toolThenMarker());
		mockGenerateText.mockResolvedValueOnce(reply(MARKER));

		const result = await processUserMessage(55562, "is sonarr up?");

		expect(result.text).toBe(noToolReply("en"));
		expect(JSON.stringify(mockHistoryVal)).not.toContain(MARKER);
		expect(lastSavedText()).toBe(noToolReply("en"));
		expect(
			mockHistoryVal.filter((message) => JSON.stringify(message).includes(noToolReply("en"))).length,
		).toBe(1);
	});
});

describe("status updates", () => {
	beforeEach(() => {
		mockGenerateText.mockReset();
		mockHistoryVal = [];
		process.env.AI_PROVIDER = "google";
		process.env.AI_MODEL_FAST = "fast-model";
		process.env.AI_MODEL_CAPABLE = "capable-model";
	});

	it("never carry the marker, while an ordinary short thought still gets through", async () => {
		mockGenerateText.mockImplementationOnce(async (params: any) => {
			await params.onStepFinish({ text: MARKER, toolCalls: [] });
			return reply(MARKER);
		});
		mockGenerateText.mockResolvedValueOnce(classifierAnswer("system"));
		mockGenerateText.mockImplementationOnce(async (params: any) => {
			await params.onStepFinish({ text: "Checking Sonarr...", toolCalls: [] });
			await params.onStepFinish({ text: `${MARKER}.`, toolCalls: [] });
			return reply("Sonarr is online.");
		});
		const statuses: string[] = [];

		await processUserMessage(55556, "is sonarr up?", async (status) => {
			statuses.push(status);
		});

		expect(statuses.some((status) => status.includes("Checking Sonarr..."))).toBe(true);
		expect(statuses.some((status) => status.includes(MARKER))).toBe(false);
	});
});

describe("a call to a tool that was not offered", () => {
	beforeEach(() => {
		mockGenerateText.mockReset();
		mockHistoryVal = [];
		process.env.AI_PROVIDER = "google";
		process.env.AI_MODEL_FAST = "fast-model";
		process.env.AI_MODEL_CAPABLE = "capable-model";
	});

	it("offers that tool and asks again instead of failing the turn", async () => {
		mockGenerateText.mockImplementationOnce(async (params: any) => {
			throw new ai.NoSuchToolError({ toolName: "searchSeries", availableTools: Object.keys(params.tools) });
		});
		mockGenerateText.mockResolvedValueOnce(reply("Sunset Harbor is a comedy about a hotel."));

		const result = await processUserMessage(55571, "pause all torrents and tell me about Sunset Harbor");

		expect(mockGenerateText).toHaveBeenCalledTimes(2);
		expect(Object.keys(requestAt(0).tools)).not.toContain("searchSeries");
		expect(Object.keys(requestAt(1).tools)).toContain("searchSeries");
		expect(Object.keys(requestAt(1).tools)).toContain("pauseAllTorrents");
		expect(result.text).toBe("Sunset Harbor is a comedy about a hotel.");
	});

	it("widens again when the retry calls another tool that is missing, then offers everything", async () => {
		const unoffered = (toolName: string) => async (params: any) => {
			throw new ai.NoSuchToolError({ toolName, availableTools: Object.keys(params.tools) });
		};
		mockGenerateText.mockImplementationOnce(unoffered("searchSeries"));
		mockGenerateText.mockImplementationOnce(unoffered("getWatchlist"));
		mockGenerateText.mockResolvedValueOnce(reply("Here it is."));

		const result = await processUserMessage(55573, "pause all torrents");

		expect(mockGenerateText).toHaveBeenCalledTimes(3);
		expect(Object.keys(requestAt(1).tools)).toContain("searchSeries");
		expect(Object.keys(requestAt(1).tools)).not.toContain("getWatchlist");
		expect(Object.keys(requestAt(2).tools)).toContain("getWatchlist");
		expect(result.text).toBe("Here it is.");
	});

	it("does not ask again once an action ran in that turn", async () => {
		mockGenerateText.mockImplementationOnce(async (params: any) => {
			await params.onStepFinish({ text: "", toolCalls: [{ toolName: "pauseAllTorrents", args: {} }] });
			throw new ai.NoSuchToolError({ toolName: "searchSeries", availableTools: Object.keys(params.tools) });
		});

		const result = await processUserMessage(55574, "pausá todas las descargas y contame de Sunset Harbor");

		expect(mockGenerateText).toHaveBeenCalledTimes(1);
		expect(result.text).toBe("Lo siento, tuve un error al procesar tu pedido.");
	});

	it("answers the error in the conversation's language", async () => {
		mockHistoryVal = [
			{ role: "user", content: "qué películas nuevas hay" },
			{ role: "assistant", content: [{ type: "text", text: "Hay varias." }] },
		];
		mockGenerateText.mockRejectedValueOnce(new Error("network down"));

		const result = await processUserMessage(55575, "Sunset Harbor 2024 completa");

		expect(result.text).toBe("Lo siento, tuve un error al procesar tu pedido.");
	});

	it("offers every tool when the name is not one of the bot's tools", async () => {
		mockGenerateText.mockImplementationOnce(async (params: any) => {
			throw new ai.NoSuchToolError({ toolName: "madeUpTool", availableTools: Object.keys(params.tools) });
		});
		mockGenerateText.mockResolvedValueOnce(reply("Done."));

		await processUserMessage(55572, "pause all torrents");

		expect(Object.keys(requestAt(1).tools).length).toBeGreaterThan(30);
	});
});
