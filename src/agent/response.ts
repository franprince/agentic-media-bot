import type { StatusLanguage } from "./status";

type ToolResultLike = {
    toolName?: string;
    result?: any;
};

const EXACT_COUNT_TOOLS = new Set(["findPlexByCountry", "browsePlexByGenre"]);

type SampleItemLike = {
    title?: string;
    originalTitle?: string;
    year?: number;
};

export function buildExactCountPrefix(toolResults: ToolResultLike[], lang: StatusLanguage): string | undefined {
    for (let i = toolResults.length - 1; i >= 0; i--) {
        const entry = toolResults[i];
        if (!entry || !EXACT_COUNT_TOOLS.has(entry.toolName || "")) continue;

        const totalFound = entry.result?.totalFound;
        if (typeof totalFound !== "number" || !Number.isFinite(totalFound)) continue;

        return lang === "es"
            ? `Encontré exactamente ${totalFound} títulos en Plex.`
            : `I found exactly ${totalFound} titles in Plex.`;
    }
    return undefined;
}

export function extractToolResultsFromMessages(messages: any[] | undefined): ToolResultLike[] {
    if (!Array.isArray(messages)) return [];

    const extracted: ToolResultLike[] = [];
    for (const message of messages) {
        if (!message || !Array.isArray(message.content)) continue;
        for (const part of message.content) {
            if (!part) continue;
            if (part.type === "tool-result") {
                extracted.push({
                    toolName: part.toolName,
                    result: part.result,
                });
            }
        }
    }
    return extracted;
}

function formatTitle(item: SampleItemLike): string {
    const title = item.title || "Untitled";
    if (typeof item.year === "number" && Number.isFinite(item.year)) return `${title} (${item.year})`;
    return title;
}

export function buildPlexBrowseAuthoritativeText(toolResults: ToolResultLike[], lang: StatusLanguage): string | undefined {
    for (let i = toolResults.length - 1; i >= 0; i--) {
        const entry = toolResults[i];
        if (!entry || !EXACT_COUNT_TOOLS.has(entry.toolName || "")) continue;

        const totalFound = entry.result?.totalFound;
        const sampleItems = Array.isArray(entry.result?.sampleItems) ? entry.result.sampleItems as SampleItemLike[] : [];

        if (typeof totalFound !== "number" || !Number.isFinite(totalFound)) continue;

        const header = lang === "es"
            ? `Encontré exactamente ${totalFound} títulos en Plex.`
            : `I found exactly ${totalFound} titles in Plex.`;

        if (sampleItems.length === 0) {
            const empty = lang === "es"
                ? "No hay títulos para mostrar en la muestra."
                : "There are no sample titles to show.";
            return `${header}\n\n${empty}`;
        }

        const listHeader = lang === "es" ? "Muestra:" : "Sample:";
        const list = sampleItems.map(item => `- ${formatTitle(item)}`).join("\n");
        return `${header}\n\n${listHeader}\n${list}`;
    }
    return undefined;
}
