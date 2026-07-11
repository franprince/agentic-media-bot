import { describe, expect, test } from "bun:test";
import { extractYearRange } from "../tmdb";

describe("TMDB Service — extractYearRange", () => {
	test("should parse year ranges correctly", () => {
		const result = extractYearRange("comedy movies 2016-2026");
		expect(result).toEqual({ gte: "2016-01-01", lte: "2026-12-31" });
	});

	test("should parse year ranges with 'to' correctly", () => {
		const result = extractYearRange("comedy movies from 2018 to 2024");
		expect(result).toEqual({ gte: "2018-01-01", lte: "2024-12-31" });
	});

	test("should parse relative ranges like 'last X years' correctly", () => {
		const result = extractYearRange("comedias de los últimos 10 años");
		const thisYear = new Date().getFullYear();
		expect(result).toEqual({
			gte: `${thisYear - 10}-01-01`,
			lte: `${thisYear}-12-31`,
		});
	});

	test("should parse relative ranges with 'last X years' in English correctly", () => {
		const result = extractYearRange("movies from last 5 years");
		const thisYear = new Date().getFullYear();
		expect(result).toEqual({
			gte: `${thisYear - 5}-01-01`,
			lte: `${thisYear}-12-31`,
		});
	});

	test("should parse 'since/desde' queries correctly", () => {
		const result = extractYearRange("best series since 2020");
		expect(result).toEqual({ gte: "2020-01-01", lte: null });
	});

	test("should parse 'until/hasta' queries correctly", () => {
		const result = extractYearRange("movies until 2022");
		expect(result).toEqual({ gte: null, lte: "2022-12-31" });
	});

	test("should parse single year queries correctly", () => {
		const result = extractYearRange("action in 2025");
		expect(result).toEqual({ gte: "2025-01-01", lte: "2025-12-31" });
	});

	test("should return null for queries without year constraints", () => {
		const result = extractYearRange("funny movies");
		expect(result).toEqual({ gte: null, lte: null });
	});
});
