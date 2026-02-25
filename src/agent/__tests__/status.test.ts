import { describe, expect, test } from "bun:test";
import { detectStatusLanguage, formatToolCallsStatus } from "../status";

describe("agent status helpers", () => {
    test("detectStatusLanguage detects Spanish", () => {
        expect(detectStatusLanguage("Tengo películas argentinas?")).toBe("es");
        expect(detectStatusLanguage("¿Puedes buscar comedias en Plex?")).toBe("es");
        expect(detectStatusLanguage("Tengo peliculas alemanas?")).toBe("es");
    });

    test("detectStatusLanguage defaults to English", () => {
        expect(detectStatusLanguage("Do I have Argentine movies?")).toBe("en");
        expect(detectStatusLanguage("Search Plex for horror movies")).toBe("en");
    });

    test("formatToolCallsStatus formats a warm Spanish fallback for Plex country", () => {
        const status = formatToolCallsStatus([{ toolName: "findPlexByCountry", args: { country: "Argentine" } }], "es");
        expect(status).toInclude("Plex");
        expect(status).toInclude("Argentina");
        expect(status.endsWith("...")).toBe(true);
    });

    test("formatToolCallsStatus localizes German country name in Spanish", () => {
        const status = formatToolCallsStatus([{ toolName: "findPlexByCountry", args: { country: "German" } }], "es");
        expect(status).toInclude("Alemania");
    });

    test("formatToolCallsStatus converts demonym to country noun in English", () => {
        const status = formatToolCallsStatus([{ toolName: "findPlexByCountry", args: { country: "German" } }], "en");
        expect(status).toInclude("Germany");
        expect(status).toBe("Searching Plex for movies from Germany...");
    });

    test("formatToolCallsStatus converts Danish demonym to Denmark", () => {
        const status = formatToolCallsStatus([{ toolName: "findPlexByCountry", args: { country: "Danish" } }], "en");
        expect(status).toBe("Searching Plex for movies from Denmark...");
    });

    test("formatToolCallsStatus formats an English fallback for Radarr search", () => {
        const status = formatToolCallsStatus([{ toolName: "searchMovie", args: { term: "Inception" } }], "en");
        expect(status).toInclude("Radarr");
        expect(status).toInclude("Inception");
        expect(status.endsWith("...")).toBe(true);
    });
});
