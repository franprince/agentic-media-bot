import { type CoreMessage } from "ai";
import { normalizeCountryName } from "../services/plex";
import { detectStatusLanguage, type StatusLanguage } from "./status";

export function getLastUserTextFromHistory(history: CoreMessage[]): string | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.role !== "user") continue;
        if (typeof msg.content === "string") return msg.content;
        if (Array.isArray(msg.content)) {
            const textPart = msg.content.find((p): p is { type: "text"; text: string } =>
                p?.type === "text" && typeof (p as any).text === "string"
            );
            if (textPart?.text) return textPart.text;
        }
    }
    return undefined;
}

export function isInvalidToolArgumentsError(error: any): boolean {
    const name = String(error?.name || "");
    const message = String(error?.message || "");
    return (
        name.includes("InvalidToolArgumentsError") ||
        message.includes("Invalid arguments for tool") ||
        Boolean(error?.toolName && error?.toolArgs)
    );
}

export function buildToolArgsRepairPrompt(toolName: string | undefined, toolArgs: string | undefined, lang: StatusLanguage): string {
    const es = lang === "es";
    const header = es
        ? "La llamada a una herramienta falló por argumentos inválidos. Los tipos de datos son incorrectos."
        : "A tool call failed due to invalid arguments. Data types are incorrect.";

    const details = [
        toolName ? `toolName: ${toolName}` : undefined,
        toolArgs ? `toolArgs: ${toolArgs}` : undefined,
    ].filter(Boolean).join("\n");

    const rules = es
        ? [
            "🔴 REGLAS CRÍTICAS DE TIPOS:",
            "- Los números deben ser NÚMEROS (sin comillas), NO strings. Ejemplo: { minutes: 90 } NO { minutes: \"90\" }",
            "- NO uses \"null\" como valor. Omite campos opcionales que no necesitas (NO incluyas el campo en absoluto).",
            "- Para 'searchPlexByDuration' con 'shorterThan' o 'longerThan': OMITE 'minutesMax' completamente, solo incluye 'comparison' y 'minutes'.",
            "- Para 'between': incluye tanto 'minutes' como 'minutesMax'.",
            "- Los IDs, años y duraciones SIEMPRE son números, nunca strings.",
            "- Si necesitas un ID/año y no lo tienes, primero llama la herramienta de búsqueda correspondiente.",
            "- Para agregar una película: usa searchMovie(term) -> elige el mejor resultado -> usa addMovie(tmdbId, title, year) con números válidos.",
            "- Si hay ambigüedad, pregunta al usuario cuál opción quiere.",
        ].join("\n")
        : [
            "🔴 CRITICAL TYPE RULES:",
            "- Numbers must be NUMBERS (no quotes), NOT strings. Example: { minutes: 90 } NOT { minutes: \"90\" }",
            "- DO NOT use \"null\" as a value. Omit optional fields you don't need (do NOT include the field at all).",
            "- For 'searchPlexByDuration' with 'shorterThan' or 'longerThan': OMIT 'minutesMax' entirely, only include 'comparison' and 'minutes'.",
            "- For 'between': include both 'minutes' and 'minutesMax'.",
            "- IDs, years, and durations are ALWAYS numbers, never strings.",
            "- If you need an ID/year and don't have it, first call the appropriate search tool.",
            "- To add a movie: use searchMovie(term) -> pick best match -> call addMovie(tmdbId, title, year) with valid numbers.",
            "- If ambiguous, ask the user to choose.",
        ].join("\n");

    const instruction = es
        ? "Vuelve a intentar, corrigiendo los tipos de datos Y los valores de las herramientas."
        : "Retry, fixing both data types AND tool argument values.";

    return [header, details && `\n${details}`, `\n${rules}`, `\n${instruction}`].filter(Boolean).join("\n");
}

export function normalizeCountryForToolLog(country: string): string {
    const noun = normalizeCountryName(country);
    return noun.charAt(0).toUpperCase() + noun.slice(1);
}

export function normalizeToolCallsForLogging(toolCalls: any[]): any[] {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls.map((call: any) => {
        if (call?.toolName !== "findPlexByCountry") return call;
        const country = call?.args?.country;
        if (typeof country !== "string" || !country.trim()) return call;
        return {
            ...call,
            args: {
                ...call.args,
                country: normalizeCountryForToolLog(country),
            },
        };
    });
}

export function shouldRewriteForTargetLanguage(text: string, target: StatusLanguage): boolean {
    const detected = detectStatusLanguage(text);
    if (target === "es") return detected !== "es";
    return detected === "es";
}

export function buildLanguageRewritePrompt(target: StatusLanguage): string {
    if (target === "es") {
        return [
            "Reescribe el siguiente mensaje completamente en español.",
            "Mantén exactamente el mismo contenido, números, títulos, viñetas, enlaces y formato Markdown.",
            "No agregues ni quites elementos; solo cambia el idioma.",
        ].join(" ");
    }
    return [
        "Rewrite the following message fully in English.",
        "Keep exactly the same facts, numbers, titles, bullet points, links, and Markdown formatting.",
        "Do not add or remove items; only change language.",
    ].join(" ");
}
