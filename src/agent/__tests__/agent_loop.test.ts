import { describe, expect, it, mock, beforeEach } from "bun:test";
import { processUserMessage } from "../index";

// Mock database
mock.module("../../services/database.ts", () => ({
    getHistory: () => [],
    saveHistory: () => { },
    getUserName: () => "Fran",
}));

// Mock plex normalization
mock.module("../../services/plex", () => ({
    normalizeCountryName: (c: string) => c.toLowerCase() === "japanese" ? "japan" : c,
}));

// Mock ai SDK
const mockGenerateText = mock();
mock.module("ai", () => ({
    generateText: mockGenerateText,
}));

describe("Agent E2E - Origin Search & Language", () => {
    beforeEach(() => {
        mockGenerateText.mockClear();
        process.env.AI_PROVIDER = "google";
        process.env.AI_MODEL_FAST = "fast-model";
        process.env.AI_MODEL_CAPABLE = "capable-model";
    });

    it("should use findPlexByCountry for 'Japanese series' and respond in English", async () => {
        const userId = 12345;
        // Step 1: Simulate LLM calling findPlexByCountry
        mockGenerateText.mockResolvedValueOnce({
            text: "Searching for Japanese series...",
            toolCalls: [
                {
                    toolName: "findPlexByCountry",
                    toolCallId: "call_123",
                    args: { country: "Japan" }
                }
            ],
            toolResults: [
                {
                    toolName: "findPlexByCountry",
                    toolCallId: "call_123",
                    result: {
                        totalFound: 2,
                        queryType: "country",
                        searchParam: "Japan",
                        sampleItems: [
                            { title: "Shogun", year: 2024 },
                            { title: "Alice in Borderland", year: 2020 }
                        ]
                    }
                }
            ],
            response: {
                messages: [
                    { role: "assistant", content: [{ type: "text", text: "..." }] },
                    {
                        role: "tool", content: [{
                            type: "tool-result", toolName: "findPlexByCountry", result: {
                                totalFound: 2,
                                queryType: "country",
                                searchParam: "Japan",
                                sampleItems: [
                                    { title: "Shogun", year: 2024 },
                                    { title: "Alice in Borderland", year: 2020 }
                                ]
                            }
                        }]
                    }
                ]
            }
        });

        // Mocking synthesized response
        mockGenerateText.mockResolvedValueOnce({
            text: "I found 2 titles in Plex.\n\nThis is the list of movies from Japan:\n- Shogun (2024)\n- Alice in Borderland (2020)",
            toolResults: [],
            response: { messages: [{ role: "assistant", content: [{ type: "text", text: "I found 2 titles in Plex..." }] }] }
        });

        const result = await processUserMessage(userId, "Do I have Japanese series?");

        expect(result.text).toContain("I found 2 titles in Plex.");
        expect(result.text).toContain("Shogun (2024)");
        expect(result.text).toContain("This is the list of movies from Japan:");
    });

    it("should trigger language rewrite if LLM responds in Spanish to English user", async () => {
        const userId = 54321;
        // Mocking a flow where LLM ignores the system prompt and replies in Spanish
        mockGenerateText.mockResolvedValueOnce({
            text: "Sí, tienes series japonesas.",
            toolResults: [],
            response: { messages: [{ role: "assistant", content: [{ type: "text", text: "Sí, tienes series japonesas." }] }] }
        });

        // Mocking the rewrite call
        mockGenerateText.mockResolvedValueOnce({
            text: "Yes, you have Japanese series.",
            toolResults: [],
            response: { messages: [{ role: "assistant", content: [{ type: "text", text: "Yes, you have Japanese series." }] }] }
        });

        const result = await processUserMessage(userId, "Do I have any Japanese series?");

        expect(result.text).toBe("Yes, you have Japanese series.");
    });
});
