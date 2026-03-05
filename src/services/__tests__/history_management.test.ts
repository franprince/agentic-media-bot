import { expect, test, describe, beforeEach } from "bun:test";
import * as db from "../database";
import type { CoreMessage } from "ai";

describe("History Management", () => {
    const userId = 999999;

    beforeEach(() => {
        db.clearHistory(userId);
    });

    test("trimHistory should keep the last N messages", () => {
        const history: CoreMessage[] = Array.from({ length: 30 }, (_, i) => ({
            role: "user",
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
