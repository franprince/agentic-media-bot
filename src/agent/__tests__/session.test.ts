import { describe, expect, it } from "bun:test";
import { isSessionExpired, SESSION_GAP_MS } from "../session";

const HOUR = 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("isSessionExpired", () => {
	it("uses a 12-hour gap", () => {
		expect(SESSION_GAP_MS).toBe(12 * HOUR);
	});

	it("keeps a conversation that was active within the gap", () => {
		expect(isSessionExpired(NOW - HOUR, NOW)).toBe(false);
		expect(isSessionExpired(NOW, NOW)).toBe(false);
	});

	it("needs more than 12 hours: exactly 12 is still the same conversation", () => {
		expect(isSessionExpired(NOW - 12 * HOUR, NOW)).toBe(false);
		expect(isSessionExpired(NOW - 12 * HOUR - 1, NOW)).toBe(true);
		expect(isSessionExpired(NOW - 48 * HOUR, NOW)).toBe(true);
	});

	it("treats a conversation with no recorded activity as expired", () => {
		expect(isSessionExpired(null, NOW)).toBe(true);
	});

	it("does not expire on a clock that went backwards", () => {
		expect(isSessionExpired(NOW + HOUR, NOW)).toBe(false);
	});
});
