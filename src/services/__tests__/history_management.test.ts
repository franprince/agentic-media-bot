import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import type { CoreMessage } from "ai";
import * as db from "../database";

describe("History Management", () => {
	const userId = 999999;

	beforeEach(() => {
		db.clearHistory(userId);
	});

	test("trimHistory should keep the last N messages", () => {
		const history: CoreMessage[] = Array.from({ length: 30 }, (_, i) => ({
			role: i % 2 === 0 ? "user" : "assistant",
			content: `Message ${i}`,
		}));

		db.saveHistory(userId, history);
		const trimmed = db.trimHistory(userId, 10);

		expect(trimmed.length).toBe(10);
		expect(trimmed[0]?.content).toBe("Message 20");
		expect(trimmed[9]?.content).toBe("Message 29");
	});

	test("trimHistory should not trim if history is shorter than maxMessages", () => {
		const history: CoreMessage[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
		];

		db.saveHistory(userId, history);
		const trimmed = db.trimHistory(userId, 10);

		expect(trimmed.length).toBe(2);
		expect(trimmed).toEqual(history);
	});
});

describe("Conversation activity timestamp", () => {
	const userId = 999998;

	beforeEach(() => {
		db.clearHistory(userId);
	});

	test("saveHistory records when the conversation was last active", () => {
		const before = Date.now();
		db.saveHistory(userId, [{ role: "user", content: "Hello" }]);
		const updatedAt = db.getConversationUpdatedAt(userId);

		expect(updatedAt).not.toBeNull();
		expect(updatedAt as number).toBeGreaterThanOrEqual(before);
		expect(updatedAt as number).toBeLessThanOrEqual(Date.now());
	});

	test("a user with no conversation has no timestamp", () => {
		expect(db.getConversationUpdatedAt(userId)).toBeNull();
	});

	test("the column is added to a database created before it existed, once", () => {
		const legacy = new Database(":memory:");
		legacy.run(
			"CREATE TABLE conversations (user_id INTEGER PRIMARY KEY, history TEXT NOT NULL)",
		);
		legacy.run("INSERT INTO conversations (user_id, history) VALUES (1, '[]')");

		db.ensureConversationTimestampColumn(legacy);
		db.ensureConversationTimestampColumn(legacy);

		const columns = legacy.query("PRAGMA table_info(conversations)").all() as {
			name: string;
		}[];
		expect(columns.map((column) => column.name)).toEqual([
			"user_id",
			"history",
			"updated_at",
		]);
		expect(
			legacy.query("SELECT user_id, history, updated_at FROM conversations").all(),
		).toEqual([{ user_id: 1, history: "[]", updated_at: null }]);
		legacy.close();
	});
});
