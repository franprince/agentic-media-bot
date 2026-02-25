function normalize(text: string): string {
    return text.toLowerCase();
}

export function isDetailsIntent(text: string): boolean {
    const t = normalize(text);
    return [
        "mas detalles",
        "más detalles",
        "detalles de",
        "dame detalles",
        "dame mas detalles",
        "dame más detalles",
        "info de",
        "informacion de",
        "información de",
        "sinopsis",
        "de que trata",
        "de qué trata",
        "plot of",
        "details about",
        "tell me more about",
        "more details",
    ].some(pattern => t.includes(pattern));
}

export function hasExplicitAddIntent(text: string): boolean {
    const t = normalize(text);
    return [
        "add ",
        "add movie",
        "add this",
        "download ",
        "download movie",
        "agrega",
        "añade",
        "anade",
        "descarga",
        "quiero que la agregues",
        "agregala",
        "agrégala",
    ].some(pattern => t.includes(pattern));
}

export function shouldDisableAddActions(text: string | undefined): boolean {
    if (!text) return false;
    return isDetailsIntent(text) && !hasExplicitAddIntent(text);
}

