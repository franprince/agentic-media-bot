import { normalizeCountryName } from "../services/plex";

export type StatusLanguage = "es" | "en";

function countSpanishSignals(text: string): number {
    const t = text.toLowerCase();
    let score = 0;

    // Punctuation/diacritics strongly suggest Spanish.
    if (/[¿¡áéíóúñü]/i.test(text)) score += 3;

    // Common Spanish words (keep short and high-signal).
    const signals = [
        "hola", "por favor", "gracias", "tengo", "quiero", "puedes", "busca", "buscar",
        "pelicula", "peliculas", "película", "películas",
        "serie", "series", "biblioteca", "agrega", "agregar", "podrias", "podes",
        "recomend", "ultimo", "último", "reciente", "faltan", "faltante", "cola", "descarga",
        "que", "lo", "la", "el", "los", "las", "un", "una", "esto", "esta", "eso", "esa", "aquel", "aquella",
        "por", "para", "de", "con", "si", "no", "pero", "porque", "cuando", "donde", "como"
    ];
    for (const s of signals) {
        if (t.includes(s)) score += 1;
    }

    return score;
}

export function detectStatusLanguage(text: string | undefined | null): StatusLanguage {
    if (!text) return "en";
    return countSpanishSignals(text) >= 2 ? "es" : "en";
}

type ToolCallLike = {
    toolName?: string;
    args?: any;
};

function pickString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    return undefined;
}

function normalizeCountryForStatus(country: string, lang: StatusLanguage): string {
    const c = country.trim();
    const noun = normalizeCountryName(country);

    if (lang === "es") {
        const esMap: Record<string, string> = {
            argentina: "Argentina",
            germany: "Alemania",
            denmark: "Dinamarca",
            netherlands: "Países Bajos",
            sweden: "Suecia",
            norway: "Noruega",
            finland: "Finlandia",
            poland: "Polonia",
            turkey: "Turquía",
            greece: "Grecia",
            portugal: "Portugal",
            france: "Francia",
            italy: "Italia",
            japan: "Japón",
            "united states": "Estados Unidos",
            "united kingdom": "Reino Unido",
            "south korea": "Corea del Sur",
        };
        return esMap[noun] || c;
    }

    // English display should use country nouns, not demonyms.
    return noun.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function formatSingleToolCall(toolCall: ToolCallLike, lang: StatusLanguage): string {
    const toolName = toolCall.toolName || "tool";
    const args = toolCall.args || {};

    const es = lang === "es";
    const wrap = (s: string) => (s.endsWith("...") ? s : `${s}...`);

    switch (toolName) {
        case "findPlexByCountry": {
            const raw = pickString(args.country) || "ese país";
            const country = normalizeCountryForStatus(raw, lang);
            return wrap(es ? `Buscando películas de ${country} en Plex` : `Searching Plex for movies from ${country}`);
        }
        case "browsePlexByGenre": {
            const genre = pickString(args.genre) || (es ? "ese género" : "that genre");
            return wrap(es ? `Buscando películas de ${genre} en Plex` : `Browsing Plex for ${genre} movies`);
        }
        case "searchPlexByTitleOnly": {
            const query = pickString(args.query) || (es ? "ese título" : "that title");
            return wrap(es ? `Buscando "${query}" en tu Plex` : `Searching your Plex for "${query}"`);
        }
        case "getRecentlyAddedPlex":
            return wrap(es ? "Revisando lo agregado recientemente en Plex" : "Fetching recently added items from Plex");
        case "getPlexLibraryStats":
            return wrap(es ? "Contando cuántas películas y series tienes en Plex" : "Counting how many movies and shows are in Plex");

        case "searchMovie": {
            const term = pickString(args.term) || (es ? "ese título" : "that title");
            return wrap(es ? `Buscando "${term}" en Radarr` : `Searching Radarr for "${term}"`);
        }
        case "addMovie": {
            const title = pickString(args.title) || (es ? "esa película" : "that movie");
            const year = pickNumber(args.year);
            const withYear = year ? `${title} (${year})` : title;
            return wrap(es ? `Agregando "${withYear}" a Radarr` : `Adding "${withYear}" to Radarr`);
        }
        case "getMovieQueue":
            return wrap(es ? "Revisando la cola de descargas de Radarr" : "Checking the Radarr download queue");
        case "getMissingMovies":
            return wrap(es ? "Revisando películas faltantes en Radarr" : "Checking for missing movies in Radarr");

        case "searchSeries": {
            const term = pickString(args.term) || (es ? "esa serie" : "that series");
            return wrap(es ? `Buscando "${term}" en Sonarr` : `Searching Sonarr for "${term}"`);
        }
        case "addSeries": {
            const title = pickString(args.title) || (es ? "esa serie" : "that series");
            return wrap(es ? `Agregando "${title}" a Sonarr` : `Adding "${title}" to Sonarr`);
        }
        case "getSeriesQueue":
            return wrap(es ? "Revisando la cola de descargas de Sonarr" : "Checking the Sonarr download queue");
        case "getMissingSeries":
            return wrap(es ? "Revisando series con episodios faltantes en Sonarr" : "Checking Sonarr for series with missing episodes");
        case "getMissingEpisodes":
            return wrap(es ? "Buscando episodios faltantes en Sonarr" : "Looking up missing episodes in Sonarr");

        case "getTorrents": {
            const filter = pickString(args.filter);
            if (filter) return wrap(es ? `Revisando tus torrents en qBittorrent (${filter})` : `Checking qBittorrent torrents (${filter})`);
            return wrap(es ? "Revisando tus torrents en qBittorrent" : "Checking qBittorrent torrents");
        }
        case "pauseTorrent":
            return wrap(es ? "Pausando ese torrent en qBittorrent" : "Pausing that torrent in qBittorrent");
        case "resumeTorrent":
            return wrap(es ? "Reanudando ese torrent en qBittorrent" : "Resuming that torrent in qBittorrent");

        case "checkServiceHealth": {
            const service = pickString(args.service) || (es ? "ese servicio" : "that service");
            return wrap(es ? `Comprobando si ${service} está en línea` : `Checking whether ${service} is reachable`);
        }

        case "discoverMedia": {
            const q = pickString(args.query);
            if (q) return wrap(es ? `Buscando recomendaciones sobre: ${q}` : `Looking for recommendations: ${q}`);
            return wrap(es ? "Buscando recomendaciones" : "Looking for recommendations");
        }

        case "saveUserName":
            return wrap(es ? "Guardando tu nombre" : "Saving your name");

        default:
            return wrap(es ? "Consultando tus servicios para responderte" : "Checking your services to answer you");
    }
}

function inferServices(toolCalls: ToolCallLike[]): string[] {
    const services = new Set<string>();
    for (const tc of toolCalls) {
        const name = tc.toolName || "";
        if (name.includes("Plex")) services.add("Plex");
        else if (name.includes("Movie") || name.includes("Radarr")) services.add("Radarr");
        else if (name.includes("Series") || name.includes("Sonarr")) services.add("Sonarr");
        else if (name.toLowerCase().includes("torrent") || name.toLowerCase().includes("qbittorrent")) services.add("qBittorrent");
        else if (name === "checkServiceHealth") services.add("servicios");
    }
    return [...services];
}

export function formatToolCallsStatus(toolCalls: ToolCallLike[], lang: StatusLanguage): string {
    const es = lang === "es";
    if (!toolCalls || toolCalls.length === 0) {
        return es ? "Pensando cómo ayudarte..." : "Thinking through how to help...";
    }
    if (toolCalls.length === 1 && toolCalls[0]) return formatSingleToolCall(toolCalls[0], lang);

    const services = inferServices(toolCalls);
    if (services.length > 0) {
        const list = services.join(es ? ", " : ", ");
        return es ? `Consultando ${list} para responderte...` : `Checking ${list} to answer you...`;
    }

    return es
        ? `Haciendo ${toolCalls.length} consultas rápidas para responderte...`
        : `Running ${toolCalls.length} quick checks to answer you...`;
}
