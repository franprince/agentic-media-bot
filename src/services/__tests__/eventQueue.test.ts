import { beforeEach, describe, expect, test } from "bun:test";
import { type QueuedEvent, webhookEventQueue } from "../eventQueue";

// Helper: build a minimal QueuedEvent
function makeEvent(
	key: string,
	dbResult = true,
	sendFn?: () => Promise<void>,
): QueuedEvent {
	return {
		key,
		label: key,
		dbSave: () => dbResult,
		send: sendFn ?? (async () => {}),
	};
}

// Reset the singleton queue between tests by draining it and clearing pending keys.
// We access via the public API only.
async function drainQueue() {
	// Wait enough microtasks for the drain loop to finish.
	await new Promise((resolve) => setTimeout(resolve, 50));
}

describe("EventQueue — in-memory deduplication", () => {
	test("enqueue returns true for a new event key", () => {
		const accepted = webhookEventQueue.enqueue(
			makeEvent("test:unique:event-1"),
		);
		expect(accepted).toBe(true);
	});

	test("enqueue returns false for a duplicate key already in the queue", async () => {
		let sendCount = 0;
		const slowSend = async () => {
			await new Promise((resolve) => setTimeout(resolve, 40));
			sendCount++;
		};

		// First enqueue — takes ~40 ms to process
		const first = webhookEventQueue.enqueue(
			makeEvent("test:dedup:slow-movie", true, slowSend),
		);

		// Second enqueue with same key while first is still being processed
		const second = webhookEventQueue.enqueue(
			makeEvent("test:dedup:slow-movie", true, slowSend),
		);

		await drainQueue();

		expect(first).toBe(true);
		expect(second).toBe(false); // dropped by in-memory dedup
		expect(sendCount).toBe(1); // only one notification sent
	});

	test("accepts same key again after the first event has finished processing", async () => {
		let sendCount = 0;
		const fastSend = async () => {
			sendCount++;
		};

		webhookEventQueue.enqueue(
			makeEvent("test:after:processed", true, fastSend),
		);
		await drainQueue();

		// Key should be gone from pendingKeys now — a new enqueue should be accepted
		const second = webhookEventQueue.enqueue(
			makeEvent("test:after:processed", true, fastSend),
		);
		await drainQueue();

		expect(second).toBe(true);
		expect(sendCount).toBe(2);
	});
});

describe("EventQueue — DB dedup safety net", () => {
	test("does not call send when dbSave returns false", async () => {
		let sendCalled = false;
		webhookEventQueue.enqueue(
			makeEvent("test:dbdedup:event", false, async () => {
				sendCalled = true;
			}),
		);
		await drainQueue();
		expect(sendCalled).toBe(false);
	});

	test("calls send when dbSave returns true", async () => {
		let sendCalled = false;
		webhookEventQueue.enqueue(
			makeEvent("test:dbnew:event", true, async () => {
				sendCalled = true;
			}),
		);
		await drainQueue();
		expect(sendCalled).toBe(true);
	});
});

describe("EventQueue — error resilience", () => {
	test("continues processing next event when send throws", async () => {
		let secondSent = false;

		// First event: send throws
		webhookEventQueue.enqueue(
			makeEvent("test:error:event-a", true, async () => {
				throw new Error("Telegram API unavailable");
			}),
		);
		// Second event: different key, should still be processed
		webhookEventQueue.enqueue(
			makeEvent("test:error:event-b", true, async () => {
				secondSent = true;
			}),
		);

		await drainQueue();
		expect(secondSent).toBe(true);
	});
});

describe("EventQueue — serial processing", () => {
	test("processes events in FIFO order", async () => {
		const order: number[] = [];

		webhookEventQueue.enqueue(
			makeEvent("test:order:1", true, async () => {
				order.push(1);
			}),
		);
		webhookEventQueue.enqueue(
			makeEvent("test:order:2", true, async () => {
				order.push(2);
			}),
		);
		webhookEventQueue.enqueue(
			makeEvent("test:order:3", true, async () => {
				order.push(3);
			}),
		);

		await drainQueue();

		expect(order).toEqual([1, 2, 3]);
	});
});
