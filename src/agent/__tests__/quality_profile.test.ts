import { describe, expect, it } from "bun:test";
import { getDefaultQualityProfile } from "../tools/radarr-tools";

interface QualityProfile {
	id: number;
	name: string;
}

describe("getDefaultQualityProfile", () => {
	it("should return undefined if profiles list is empty or undefined", () => {
		expect(getDefaultQualityProfile([])).toBeUndefined();
	});

	it("should prioritize 'Full-HD or Better (NO REMUX)' case-insensitively and with normalizations", () => {
		const profiles: QualityProfile[] = [
			{ id: 1, name: "SD" },
			{ id: 2, name: "HD-720p" },
			{ id: 3, name: "Full-HD or Better (NO REMUX)" },
			{ id: 4, name: "Ultra-HD" },
		];
		const result = getDefaultQualityProfile(profiles);
		expect(result).toBeDefined();
		expect(result?.id).toBe(3);
		expect(result?.name).toBe("Full-HD or Better (NO REMUX)");
	});

	it("should find normalized and case-insensitive variations of Full-HD or Better (NO REMUX)", () => {
		const profiles: QualityProfile[] = [
			{ id: 1, name: "full-hd or better (no remux)" },
			{ id: 2, name: "FullHD or Better (NO REMUX)" },
			{ id: 3, name: "Full-HD or Better (NO_REMUX)" },
		];
		const result1 = getDefaultQualityProfile([profiles[0]!]);
		expect(result1?.id).toBe(1);

		const result2 = getDefaultQualityProfile([profiles[1]!]);
		expect(result2?.id).toBe(2);

		const result3 = getDefaultQualityProfile([profiles[2]!]);
		expect(result3?.id).toBe(3);
	});

	it("should fall back to standard Full-HD, Full HD, or 1080p if the exact profile is not found", () => {
		const profiles: QualityProfile[] = [
			{ id: 1, name: "SD" },
			{ id: 2, name: "HDTV" },
			{ id: 3, name: "Full-HD" },
			{ id: 4, name: "1080p" },
		];
		const result = getDefaultQualityProfile(profiles);
		expect(result?.id).toBe(3);
	});

	it("should fall back to 1080p if Full-HD is not present", () => {
		const profiles: QualityProfile[] = [
			{ id: 1, name: "SD" },
			{ id: 2, name: "1080p" },
		];
		const result = getDefaultQualityProfile(profiles);
		expect(result?.id).toBe(2);
	});

	it("should return the first profile if no preferred keyword is matched", () => {
		const profiles: QualityProfile[] = [
			{ id: 7, name: "Any Profile" },
			{ id: 8, name: "Ultra-HD Only" },
		];
		const result = getDefaultQualityProfile(profiles);
		expect(result?.id).toBe(7);
	});
});
