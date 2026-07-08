import { describe, expect, it } from "bun:test";
import { convertMarkdownTablesToLists } from "../utils";

describe("convertMarkdownTablesToLists", () => {
    it("should pass through normal text unmodified", () => {
        const input = "Hello, this is a test message without any tables.";
        expect(convertMarkdownTablesToLists(input)).toBe(input);
    });

    it("should convert a single markdown table to a list", () => {
        const input = [
            "¡Aquí tienes las mejores comedias recomendadas!",
            "",
            "| # | Película | Año | Géneros | ⭐ Rating |",
            "|---|---|---|---|---|",
            "| 1 | Accidental Partners | 2026 | Comedia, Romance | 9.1 |",
            "| 2 | Miss Kobayashi's Dragon Maid | 2025 | Animación, Comedia, Fantasía | 8.8 |",
            "",
            "¿Te interesa alguna?"
        ].join("\n");

        const expected = [
            "¡Aquí tienes las mejores comedias recomendadas!",
            "",
            "1. **Accidental Partners** (2026) • Comedia, Romance • ⭐ 9.1",
            "2. **Miss Kobayashi's Dragon Maid** (2025) • Animación, Comedia, Fantasía • ⭐ 8.8",
            "",
            "¿Te interesa alguna?"
        ].join("\n");

        expect(convertMarkdownTablesToLists(input)).toBe(expected);
    });

    it("should handle missing optional columns gracefully", () => {
        const input = [
            "| Title | Year |",
            "|---|---|",
            "| Inception | 2010 |",
            "| Interstellar | 2014 |"
        ].join("\n");

        const expected = [
            "- **Inception** (2010)",
            "- **Interstellar** (2014)"
        ].join("\n");

        expect(convertMarkdownTablesToLists(input)).toBe(expected);
    });
});
