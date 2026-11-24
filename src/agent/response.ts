import type { CoreMessage } from "ai";
import { NEED_MORE_TOOLS_MARKER } from "./prompts";
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

export function buildExactCountPrefix(
	toolResults: ToolResultLike[],
	lang: StatusLanguage,
): string | undefined {
	for (let i = toolResults.length - 1; i >= 0; i--) {
		const entry = toolResults[i];
		if (!entry || !EXACT_COUNT_TOOLS.has(entry.toolName || "")) continue;

		const totalFound = entry.result?.totalFound;
		if (typeof totalFound !== "number" || !Number.isFinite(totalFound))
			continue;

		return lang === "es"
			? `Encontré ${totalFound} títulos en Plex.`
			: `I found ${totalFound} titles in Plex.`;
	}
	return undefined;
}

export function extractToolResultsFromMessages(
	messages: any[] | undefined,
): ToolResultLike[] {
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
	return /[^\u0000-\u024f\s"'`~!@#$%^&*()\-_=+[\]{}\\|;:,./<>?0-9]/.test(value);
}

function formatTitle(item: SampleItemLike, lang: StatusLanguage): string {
	const title = item.title || "Untitled";
	const originalTitle = item.originalTitle?.trim();
	const yearSuffix =
		typeof item.year === "number" && Number.isFinite(item.year)
			? ` (${item.year})`
			: "";

	// If original title exists and differs from the main title, show it in parentheses
	if (originalTitle && originalTitle !== title) {
		return `${title} (${originalTitle})${yearSuffix}`;
	}

	return `${title}${yearSuffix}`;
}

export function buildPlexBrowseAuthoritativeText(
	toolResults: ToolResultLike[],
	lang: StatusLanguage,
): string | undefined {
	for (let i = toolResults.length - 1; i >= 0; i--) {
		const entry = toolResults[i];
		if (!entry || !EXACT_COUNT_TOOLS.has(entry.toolName || "")) continue;

		const totalFound = entry.result?.totalFound;
		const sampleItems = Array.isArray(entry.result?.sampleItems)
			? (entry.result.sampleItems as SampleItemLike[])
			: [];
		const customListLabel =
			typeof entry.result?.listLabel === "string"
				? entry.result.listLabel
				: undefined;
		const searchParam =
			typeof entry.result?.searchParam === "string"
				? entry.result.searchParam
				: undefined;
		const queryType =
			entry.result?.queryType === "country" ||
			entry.result?.queryType === "genre"
				? (entry.result.queryType as "country" | "genre")
				: undefined;
		const ranked = entry.result?.ranked === true;
		const requestedLimit =
			typeof entry.result?.requestedLimit === "number" &&
			Number.isFinite(entry.result.requestedLimit)
				? entry.result.requestedLimit
				: undefined;

		if (typeof totalFound !== "number" || !Number.isFinite(totalFound))
			continue;

		const header =
			lang === "es"
				? `Encontré ${totalFound} títulos en Plex.`
				: `I found ${totalFound} titles in Plex.`;

		if (sampleItems.length === 0) {
			const empty =
				lang === "es"
					? "No hay títulos para mostrar en la muestra."
					: "There are no sample titles to show.";
			return `${header}\n\n${empty}`;
		}

		const rankedHeader = ranked
			? lang === "es"
				? `Top ${Math.min(requestedLimit ?? sampleItems.length, sampleItems.length)} por calificación`
				: `Top ${Math.min(requestedLimit ?? sampleItems.length, sampleItems.length)} by rating`
			: undefined;

		const listHeader =
			customListLabel ||
			rankedHeader ||
			(searchParam && queryType === "country"
				? lang === "es"
					? `Esta es la lista de películas de ${searchParam}:`
					: `This is the list of movies from ${searchParam}:`
				: searchParam
					? lang === "es"
						? `Esta es la lista de películas de ${searchParam}:`
						: `This is the list of ${searchParam} movies:`
					: lang === "es"
						? "Esta es la lista de películas encontradas:"
						: "This is the list of matching movies:");
		const list = sampleItems
			.map((item) => `- ${formatTitle(item, lang)}`)
			.join("\n");
		return `${header}\n\n${listHeader}\n${list}`;
	}
	return undefined;
}

export type ReplyButton = { text: string; data: string };

/** Telegram rejects callback_data outside 1–64 bytes (the whole message fails). */
const MAX_CALLBACK_DATA_BYTES = 64;

function truncateUtf8(value: string, maxBytes: number): string {
	const encoder = new TextEncoder();
	if (encoder.encode(value).length <= maxBytes) return value;
	let out = "";
	for (const char of value) {
		if (encoder.encode(out + char).length > maxBytes) break;
		out += char;
	}
	return out;
}

/**
 * Picks the buttons for a reply.
 *
 * A tool that needs a decision (add/remove confirmation) returns its own
 * buttons carrying the real IDs and default settings (e.g. "add movie
 * <tmdbId> <defaultProfileId>"). Those are authoritative: the model is also
 * told to end questions with `BUTTON:` lines, and its generic copies
 * ("add_movie_confirm") would otherwise be shown next to them. Model buttons
 * are used only when no tool supplied any; while a confirmation is pending,
 * premature notification buttons are dropped.
 */
export function selectReplyButtons(
	toolButtons: ReplyButton[] | undefined,
	modelButtons: ReplyButton[],
	confirmationPending: boolean,
): ReplyButton[] | undefined {
	const chosen =
		toolButtons && toolButtons.length > 0
			? toolButtons
			: confirmationPending
				? modelButtons.filter(
						(btn) =>
							!btn.data.startsWith("notify_download_confirm_") &&
							btn.data !== "notify_download_decline",
					)
				: modelButtons;
	const seen = new Set<string>();
	const valid: ReplyButton[] = [];
	for (const btn of chosen) {
		const text = (btn.text ?? "").trim();
		const data = truncateUtf8((btn.data ?? "").trim(), MAX_CALLBACK_DATA_BYTES);
		if (!text || !data || seen.has(data)) continue;
		seen.add(data);
		valid.push({ ...btn, text, data });
	}
	return valid.length > 0 ? valid : undefined;
}

/** Sent when no tool covers a request and the model gave no answer of its own. */
export function noToolReply(lang: StatusLanguage): string {
	return lang === "es"
		? "Eso todavía no lo puedo hacer. 😕 Puedo buscar, agregar y quitar películas y series, revisar tus descargas y tu biblioteca de Plex, y recomendarte qué ver."
		: "I can't do that yet. 😕 I can search, add and remove movies and series, check your downloads and your Plex library, and recommend what to watch.";
}

/** Removes the internal marker; text left without a letter or digit counts as empty. */
export function scrubMarker(text: string): string {
	const cleaned = text.replaceAll(NEED_MORE_TOOLS_MARKER, "").trim();
	return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

/**
 * Cleans the marker out of assistant text before it is saved, so the model
 * never reads it back as its own earlier answer. Text emptied by the cleaning
 * is dropped, except in the last assistant message — the reply the user got —
 * where it takes `fallback` when there is one. Returns new messages.
 */
export function scrubMarkerFromMessages(
	messages: CoreMessage[],
	fallback: string,
): CoreMessage[] {
	const hasMarker = (text: unknown): text is string =>
		typeof text === "string" && text.includes(NEED_MORE_TOOLS_MARKER);
	const finalReply = messages.map((message) => message.role).lastIndexOf("assistant");
	const scrubbed: CoreMessage[] = [];
	messages.forEach((message, index) => {
		if (message.role !== "assistant") {
			scrubbed.push(message);
			return;
		}
		const emptied = index === finalReply ? fallback : "";
		if (typeof message.content === "string") {
			if (!hasMarker(message.content)) {
				scrubbed.push(message);
				return;
			}
			const text = scrubMarker(message.content) || emptied;
			if (text) scrubbed.push({ ...message, content: text });
			return;
		}
		const parts: any[] = [];
		for (const part of message.content as any[]) {
			if (part?.type !== "text" || !hasMarker(part.text)) {
				parts.push(part);
				continue;
			}
			const text = scrubMarker(part.text) || emptied;
			if (text) parts.push({ ...part, text });
		}
		if (parts.length > 0) scrubbed.push({ ...message, content: parts } as CoreMessage);
	});
	return scrubbed;
}
