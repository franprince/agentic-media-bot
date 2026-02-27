import { describe, expect, it } from "bun:test";
import { detectStatusLanguage } from "../status";

describe("detectStatusLanguage", () => {
    it("should detect English by default", () => {
        expect(detectStatusLanguage("Check my movies")).toBe("en");
        expect(detectStatusLanguage("")).toBe("en");
        expect(detectStatusLanguage(null)).toBe("en");
    });

    it("should detect Spanish with strong diacritics", () => {
        expect(detectStatusLanguage("¿Puedes buscar una película?")).toBe("es");
        expect(detectStatusLanguage("película")).toBe("es");
    });

    it("should detect Spanish with common words even in short sentences", () => {
        // High frequency Spanish words added in v4.2.1
        expect(detectStatusLanguage("recomiéndame comedias")).toBe("es");
        expect(detectStatusLanguage("de que trata esto")).toBe("es");
        expect(detectStatusLanguage("no quiero eso")).toBe("es");
    });

    it("should return English for mixed but primarily English messages", () => {
        expect(detectStatusLanguage("Search for a movie called La Casa")).toBe("en");
    });
});
