import type { StatusLanguage } from "./status";

type ToolResultLike = {
    toolName?: string;
    result?: any;
};

const EXACT_COUNT_TOOLS = new Set(["findPlexByCountry", "browsePlexByGenre"]);

type SampleItemLike = {
    title?: string;
    originalTitle?: string;
    aliasTitle?: string;
    year?: number;
};

export function buildExactCountPrefix(toolResults: ToolResultLike[], lang: StatusLanguage): string | undefined {
    for (let i = toolResults.length - 1; i >= 0; i--) {
        const entry = toolResults[i];
        if (!entry || !EXACT_COUNT_TOOLS.has(entry.toolName || "")) continue;

        const totalFound = entry.result?.totalFound;
        if (typeof totalFound !== "number" || !Number.isFinite(totalFound)) continue;

        return lang === "es"
            ? `Encontré ${totalFound} títulos en Plex.`
            : `I found ${totalFound} titles in Plex.`;
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

function hasNonLatinCharacters(value: string): boolean {
    return /[^\u0000-\u024f\s"'`~!@#$%^&*()\-_=+\[\]{}\\|;:,./<>?0-9]/.test(value);
}

function formatTitle(item: SampleItemLike, lang: StatusLanguage): string {
    const title = item.title || "Untitled";
    const originalTitle = item.originalTitle?.trim();
    const aliasTitle = item.aliasTitle?.trim();
    const normalizedTitle = title.toLowerCase();
    const candidates = [originalTitle, aliasTitle].filter((value): value is string => Boolean(value));
    const latinAlias = candidates.find((value) =>
        value.toLowerCase() !== normalizedTitle && !hasNonLatinCharacters(value)
    );
    const fallbackAlias = candidates.find((value) => value.toLowerCase() !== normalizedTitle);
    const displayAlias = latinAlias || fallbackAlias;
    const yearSuffix = typeof item.year === "number" && Number.isFinite(item.year) ? ` (${item.year})` : "";

    if (displayAlias && displayAlias.toLowerCase() !== title.toLowerCase()) {
        return `${title} (${displayAlias})${yearSuffix}`;
    }

    if (hasNonLatinCharacters(title)) {
        const missingAliasLabel = lang === "es"
            ? "título en inglés/español no disponible"
            : "English/Spanish title unavailable";
        return `${title} (${missingAliasLabel})${yearSuffix}`;
    }

    return `${title}${yearSuffix}`;
}

export function buildPlexBrowseAuthoritativeText(toolResults: ToolResultLike[], lang: StatusLanguage): string | undefined {
    for (let i = toolResults.length - 1; i >= 0; i--) {
        const entry = toolResults[i];
        if (!entry || !EXACT_COUNT_TOOLS.has(entry.toolName || "")) continue;

        const totalFound = entry.result?.totalFound;
        const sampleItems = Array.isArray(entry.result?.sampleItems) ? entry.result.sampleItems as SampleItemLike[] : [];
        const customListLabel = typeof entry.result?.listLabel === "string" ? entry.result.listLabel : undefined;
        const searchParam = typeof entry.result?.searchParam === "string" ? entry.result.searchParam : undefined;
        const queryType = entry.result?.queryType === "country" || entry.result?.queryType === "genre"
            ? entry.result.queryType as "country" | "genre"
            : undefined;
        const ranked = entry.result?.ranked === true;
        const requestedLimit = typeof entry.result?.requestedLimit === "number" && Number.isFinite(entry.result.requestedLimit)
            ? entry.result.requestedLimit
            : undefined;

        if (typeof totalFound !== "number" || !Number.isFinite(totalFound)) continue;

        const header = lang === "es"
            ? `Encontré ${totalFound} títulos en Plex.`
            : `I found ${totalFound} titles in Plex.`;

        if (sampleItems.length === 0) {
            const empty = lang === "es"
                ? "No hay títulos para mostrar en la muestra."
                : "There are no sample titles to show.";
            return `${header}\n\n${empty}`;
        }

        const rankedHeader = ranked
            ? (lang === "es"
                ? `Top ${Math.min(requestedLimit ?? sampleItems.length, sampleItems.length)} por calificación`
                : `Top ${Math.min(requestedLimit ?? sampleItems.length, sampleItems.length)} by rating`)
            : undefined;

        const listHeader = customListLabel
            || rankedHeader
            || (searchParam && queryType === "country"
                ? (lang === "es"
                    ? `Esta es la lista de películas de ${searchParam}:`
                    : `This is the list of movies from ${searchParam}:`)
                : searchParam
                    ? (lang === "es"
                        ? `Esta es la lista de películas de ${searchParam}:`
                        : `This is the list of ${searchParam} movies:`)
                    : (lang === "es"
                        ? "Esta es la lista de películas encontradas:"
                        : "This is the list of matching movies:"));
        const list = sampleItems.map(item => `- ${formatTitle(item, lang)}`).join("\n");
        return `${header}\n\n${listHeader}\n${list}`;
    }
    return undefined;
}
