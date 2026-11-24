import { afterAll, describe, expect, it, mock, beforeEach, spyOn } from "bun:test";
import * as agent from "../../agent/index";
import { registerMessageHandlers, safeReply } from "../messages";

describe("Bot Messages - safeReply", () => {
	let sendPhotoSpy: any;
	let replySpy: any;
	let ctx: any;

	beforeEach(() => {
		sendPhotoSpy = mock(() => Promise.resolve({ message_id: 1 }));
		replySpy = mock(() => Promise.resolve({ message_id: 2 }));

		ctx = {
			chat: { id: 12345 },
			api: {
				sendPhoto: sendPhotoSpy,
			},
			reply: replySpy,
		};
	});

	it("should send photo with caption if caption is shorter than 1024 characters", async () => {
		const text = "Short caption";
		const imageUrl = "https://example.com/image.jpg";

		await safeReply(ctx, text, imageUrl, "user123");

		// Should call sendPhoto with the caption option
		expect(sendPhotoSpy).toHaveBeenCalledTimes(1);
		expect(sendPhotoSpy.mock.calls[0]?.[0]).toBe(12345);
		expect(sendPhotoSpy.mock.calls[0]?.[1]).toBe(imageUrl);
		expect(sendPhotoSpy.mock.calls[0]?.[2]).toBeDefined();
		expect(sendPhotoSpy.mock.calls[0]?.[2]?.caption).toBe(text);

		// Should NOT call reply
		expect(replySpy).not.toHaveBeenCalled();
	});

	it("should send photo without caption and then send text separately if caption is longer than 1024 characters", async () => {
		const text = "a".repeat(1100); // 1100 characters long caption
		const imageUrl = "https://example.com/image.jpg";

		await safeReply(ctx, text, imageUrl, "user123");

		// Should call sendPhoto WITHOUT caption
		expect(sendPhotoSpy).toHaveBeenCalledTimes(1);
		expect(sendPhotoSpy.mock.calls[0]?.[0]).toBe(12345);
		expect(sendPhotoSpy.mock.calls[0]?.[1]).toBe(imageUrl);
		expect(sendPhotoSpy.mock.calls[0]?.[2]).toBeUndefined();

		// Should call reply with the full text
		expect(replySpy).toHaveBeenCalledTimes(1);
		expect(replySpy.mock.calls[0]?.[0]).toBe(text);
		expect(replySpy.mock.calls[0]?.[1]).toBeDefined();
		expect(replySpy.mock.calls[0]?.[1]?.parse_mode).toBe("Markdown");
	});

	it("should fallback to sending text separately when markdown parsing fails and text is too long", async () => {
		const text = "a".repeat(1100) + "*invalid markdown";
		const imageUrl = "https://example.com/image.jpg";

		// Force the reply call with parse_mode Markdown to fail
		replySpy = mock((textParam: any, options: any) => {
			if (options && options.parse_mode === "Markdown") {
				const err: any = new Error("Bad Request: can't parse entities");
				err.description = "can't parse entities";
				return Promise.reject(err);
			}
			return Promise.resolve({ message_id: 2 });
		});
		ctx.reply = replySpy;

		await safeReply(ctx, text, imageUrl, "user123");

		// Should call sendPhoto once (succeeds without caption/markdown)
		expect(sendPhotoSpy).toHaveBeenCalledTimes(1);
		expect(sendPhotoSpy.mock.calls[0]?.[2]).toBeUndefined();

		// Should call reply twice (first with markdown fails, second with plain text succeeds)
		expect(replySpy).toHaveBeenCalledTimes(2);
		expect(replySpy.mock.calls[1]?.[0]).toBe(text);
		expect(replySpy.mock.calls[1]?.[1]).toBeDefined();
		expect(replySpy.mock.calls[1]?.[1]?.parse_mode).toBeUndefined();
	});
});

describe("Bot Messages - typed text vs. button taps", () => {
	const processSpy = spyOn(agent, "processUserMessage").mockImplementation(
		async () => ({ text: "ok" }),
	);
	const handlers = new Map<string, (ctx: any) => Promise<void>>();
	registerMessageHandlers(
		{ on: (event: string, handler: any) => handlers.set(event, handler) } as any,
		"token",
		new Map(),
	);

	function fakeContext(extra: Record<string, any>) {
		return {
			from: { id: 4242, first_name: "Tester" },
			chat: { id: 4242 },
			answerCallbackQuery: mock(async () => {}),
			replyWithChatAction: mock(async () => {}),
			reply: mock(async () => ({ message_id: 2 })),
			api: {
				sendMessage: mock(async () => ({ message_id: 1 })),
				editMessageText: mock(async () => {}),
				deleteMessage: mock(async () => {}),
			},
			...extra,
		};
	}

	beforeEach(() => {
		processSpy.mockClear();
	});

	afterAll(() => {
		processSpy.mockRestore();
	});

	it("marks a button tap, so it continues its conversation", async () => {
		const handler = handlers.get("callback_query:data");
		await handler?.(fakeContext({ callbackQuery: { data: "add movie 1 4" } }));

		expect(processSpy).toHaveBeenCalledTimes(1);
		expect(processSpy.mock.calls[0]?.[0]).toBe(4242);
		expect(processSpy.mock.calls[0]?.[1]).toBe("add movie 1 4");
		expect(processSpy.mock.calls[0]?.[3]).toEqual({ fromButton: true });
	});

	it("does not mark a typed message", async () => {
		const handler = handlers.get("message:text");
		await handler?.(fakeContext({ message: { text: "hola" } }));

		expect(processSpy).toHaveBeenCalledTimes(1);
		expect(processSpy.mock.calls[0]?.[1]).toBe("hola");
		expect((processSpy.mock.calls[0]?.[3] as any)?.fromButton).toBeFalsy();
	});
});
