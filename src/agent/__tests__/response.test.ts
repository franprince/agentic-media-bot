import { describe, expect, test } from "bun:test";
import { buildExactCountPrefix, buildPlexBrowseAuthoritativeText, extractToolResultsFromMessages } from "../response";

describe("response helpers", () => {
    test("builds Spanish exact-count prefix for country/genre Plex tools", () => {
        const prefix = buildExactCountPrefix(
            [{ toolName: "findPlexByCountry", result: { totalFound: 14 } }],
            "es"
        );
        expect(prefix).toBe("Encontré exactamente 14 títulos en Plex.");
    });

    test("builds English exact-count prefix for country/genre Plex tools", () => {
        const prefix = buildExactCountPrefix(
            [{ toolName: "browsePlexByGenre", result: { totalFound: 8 } }],
            "en"
        );
        expect(prefix).toBe("I found exactly 8 titles in Plex.");
    });

    test("returns undefined when no exact-count tool results exist", () => {
        const prefix = buildExactCountPrefix(
            [{ toolName: "searchMovie", result: [] }],
            "en"
        );
        expect(prefix).toBeUndefined();
    });

    test("extracts tool results from message parts", () => {
        const extracted = extractToolResultsFromMessages([
            {
                role: "tool",
                content: [
                    { type: "tool-result", toolName: "findPlexByCountry", result: { totalFound: 14 } },
                ],
            },
        ]);

        expect(extracted.length).toBe(1);
        expect(extracted[0]?.toolName).toBe("findPlexByCountry");
        expect(extracted[0]?.result?.totalFound).toBe(14);
    });

    test("builds authoritative Spanish Plex browse text with exact count and sample list", () => {
        const text = buildPlexBrowseAuthoritativeText(
            [{
                toolName: "findPlexByCountry",
                result: {
                    totalFound: 2,
                    sampleItems: [{ title: "Das Boot", year: 1981 }, { title: "M", year: 1931 }],
                },
            }],
            "es"
        );

        expect(text).toInclude("Encontré exactamente 2 títulos en Plex.");
        expect(text).toInclude("- Das Boot (1981)");
        expect(text).toInclude("- M (1931)");
    });

    test("uses custom list label when provided by tool result", () => {
        const text = buildPlexBrowseAuthoritativeText(
            [{
                toolName: "findPlexByCountry",
                result: {
                    totalFound: 12,
                    listLabel: "Top 10 by rating",
                    sampleItems: [{ title: "Movie A", year: 2001 }],
                },
            }],
            "en"
        );

        expect(text).toInclude("I found exactly 12 titles in Plex.");
        expect(text).toInclude("Top 10 by rating");
    });

    test("includes original title when it differs", () => {
        const text = buildPlexBrowseAuthoritativeText(
            [{
                toolName: "findPlexByCountry",
                result: {
                    totalFound: 1,
                    sampleItems: [{ title: "オーディション", originalTitle: "Audition", year: 1999 }],
                },
            }],
            "en"
        );

        expect(text).toInclude("- オーディション (Audition) (1999)");
    });

    test("does not duplicate alias when titles are the same", () => {
        const text = buildPlexBrowseAuthoritativeText(
            [{
                toolName: "findPlexByCountry",
                result: {
                    totalFound: 1,
                    sampleItems: [{ title: "Perfect Days", originalTitle: "Perfect Days", year: 2023 }],
                },
            }],
            "en"
        );

        expect(text).toInclude("- Perfect Days (2023)");
        expect(text).not.toInclude("Perfect Days (Perfect Days)");
    });
});
