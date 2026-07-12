import type { CoreMessage } from "ai";
import { normalizeCountryName } from "../services/plex";
import { detectStatusLanguage, type StatusLanguage } from "./status";

export function getLastUserTextFromHistory(
	history: CoreMessage[],
): string | undefined {
	for (let i = history.length - 1; i >= 0; i--) {
		const msg = history[i];
		if (msg?.role !== "user") continue;
		if (typeof msg.content === "string") return msg.content;
		if (Array.isArray(msg.content)) {
			const textPart = msg.content.find(
				(p): p is { type: "text"; text: string } =>
					p?.type === "text" && typeof (p as any).text === "string",
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

export function buildToolArgsRepairPrompt(
	toolName: string | undefined,
	toolArgs: string | undefined,
	lang: StatusLanguage,
): string {
	const es = lang === "es";
	const header = es
		? "La llamada a una herramienta falló por argumentos inválidos. Los tipos de datos son incorrectos."
		: "A tool call failed due to invalid arguments. Data types are incorrect.";

	const details = [
		toolName ? `toolName: ${toolName}` : undefined,
		toolArgs ? `toolArgs: ${toolArgs}` : undefined,
	]
		.filter(Boolean)
		.join("\n");

	const rules = es
		? [
				"🔴 REGLAS CRÍTICAS DE TIPOS:",
				'- Los números deben ser NÚMEROS (sin comillas), NO strings. Ejemplo: { minutes: 90 } NO { minutes: "90" }',
				'- NO uses "null" como valor. Omite campos opcionales que no necesitas (NO incluyas el campo en absoluto).',
				"- Para 'searchPlexByDuration' con 'shorterThan' o 'longerThan': OMITE 'minutesMax' completamente, solo incluye 'comparison' y 'minutes'.",
				"- Para 'between': incluye tanto 'minutes' como 'minutesMax'.",
				"- Los IDs, años y duraciones SIEMPRE son números, nunca strings.",
				"- Si necesitas un ID/año y no lo tienes, primero llama la herramienta de búsqueda correspondiente.",
				"- Para agregar una película: usa searchMovie(term) -> elige el mejor resultado -> usa addMovie(tmdbId, title, year) con números válidos.",
				"- Si hay ambigüedad, pregunta al usuario cuál opción quiere.",
			].join("\n")
		: [
				"🔴 CRITICAL TYPE RULES:",
				'- Numbers must be NUMBERS (no quotes), NOT strings. Example: { minutes: 90 } NOT { minutes: "90" }',
				'- DO NOT use "null" as a value. Omit optional fields you don\'t need (do NOT include the field at all).',
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

	return [header, details && `\n${details}`, `\n${rules}`, `\n${instruction}`]
		.filter(Boolean)
		.join("\n");
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

export function shouldRewriteForTargetLanguage(
	text: string,
	target: StatusLanguage,
): boolean {
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
			"IMPORTANT: For button lines formatted as 'BUTTON: label | callback_data', you MUST translate the 'label' to Spanish but leave the 'callback_data' EXACTLY as it is. Do NOT translate or modify the callback_data.",
		].join(" ");
	}
	return [
		"Rewrite the following message fully in English.",
		"Keep exactly the same facts, numbers, titles, bullet points, links, and Markdown formatting.",
		"Do not add or remove items; only change language.",
		"IMPORTANT: For button lines formatted as 'BUTTON: label | callback_data', you MUST translate the 'label' to English but leave the 'callback_data' EXACTLY as it is. Do NOT translate or modify the callback_data.",
	].join(" ");
}

export function convertMarkdownTablesToLists(text: string): string {
	const lines = text.split("\n");
	const resultLines: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];
		if (line === undefined) break;

		// Detect start of a table
		if (line.trim().startsWith("|") && line.trim().endsWith("|")) {
			const tableLines: string[] = [];
			while (i < lines.length) {
				const currentLine = lines[i];
				if (
					currentLine &&
					currentLine.trim().startsWith("|") &&
					currentLine.trim().endsWith("|")
				) {
					tableLines.push(currentLine.trim());
					i++;
				} else {
					break;
				}
			}

			// Process the collected table lines
			const processedTable = parseAndFormatTable(tableLines);
			resultLines.push(processedTable);
		} else {
			resultLines.push(line);
			i++;
		}
	}

	return resultLines.join("\n");
}

function parseAndFormatTable(lines: string[]): string {
	if (lines.length < 2) return lines.join("\n"); // Not a valid table

	const getCells = (row: string) => {
		const parts = row.split("|");
		return parts.slice(1, parts.length - 1).map((c) => c.trim());
	};

	const headerCells = getCells(lines[0] || "");

	let startIndex = 1;
	if (lines[1] && (lines[1].includes("---") || lines[1].includes("-:-"))) {
		startIndex = 2;
	}

	const rows: string[] = [];
	for (let idx = startIndex; idx < lines.length; idx++) {
		const rowLine = lines[idx];
		if (!rowLine) continue;
		const cells = getCells(rowLine);
		if (cells.length === 0 || cells.every((c) => c === "")) continue;

		const numNames = ["#", "num", "id", "no.", "position", "posición"];
		const titleNames = [
			"title",
			"movie",
			"película",
			"show",
			"series",
			"serie",
			"nombre",
			"título",
			"name",
			"tv",
			"programa",
		];
		const yearNames = ["year", "año", "fecha", "date"];
		const genresNames = [
			"genre",
			"genres",
			"género",
			"géneros",
			"categoría",
			"categorías",
			"tags",
		];
		const ratingNames = ["rating", "calificación", "voto", "score", "⭐"];

		const allColumns = [
			{ name: "num", patterns: numNames },
			{ name: "title", patterns: titleNames },
			{ name: "year", patterns: yearNames },
			{ name: "genres", patterns: genresNames },
			{ name: "rating", patterns: ratingNames },
		];

		const getColumnVal = (possibleNames: string[], defaultIndex: number) => {
			const colIndex = headerCells.findIndex((h) =>
				possibleNames.some((name) =>
					h.toLowerCase().includes(name.toLowerCase()),
				),
			);
			if (colIndex !== -1) return cells[colIndex] || "";

			const defaultHeader = headerCells[defaultIndex]?.toLowerCase();
			if (defaultHeader) {
				const isClaimedByOthers = allColumns.some((col) => {
					const matchesOurs = possibleNames.some((p) =>
						col.patterns.includes(p),
					);
					if (matchesOurs) return false;
					return col.patterns.some((p) => defaultHeader.includes(p));
				});
				if (isClaimedByOthers) return "";
			}

			return cells[defaultIndex] || "";
		};

		const num = getColumnVal(numNames, 0);
		const title = getColumnVal(titleNames, 1);
		const year = getColumnVal(yearNames, 2);
		const genres = getColumnVal(genresNames, 3);
		const rating = getColumnVal(ratingNames, 4);

		let rowText = "";
		if (num) {
			rowText += `${num}. `;
		} else {
			rowText += `- `;
		}

		rowText += `**${title}**`;

		if (year) {
			rowText += ` (${year})`;
		}

		const details: string[] = [];
		if (genres) {
			details.push(genres);
		}
		if (rating) {
			const ratingStr = rating.includes("⭐") ? rating : `⭐ ${rating}`;
			details.push(ratingStr);
		}

		if (details.length > 0) {
			rowText += ` • ${details.join(" • ")}`;
		}

		rows.push(rowText);
	}

	return rows.join("\n");
}
