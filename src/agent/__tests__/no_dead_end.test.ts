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
		const narrowed = mockGenerateText.mock.calls[0][0];
		const widened = mockGenerateText.mock.calls[2][0];
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
