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
	].some((pattern) => t.includes(pattern));
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
	].some((pattern) => t.includes(pattern));
}

export function shouldDisableAddActions(text: string | undefined): boolean {
	if (!text) return false;
	return isDetailsIntent(text) && !hasExplicitAddIntent(text);
}

export function hasNameIntent(text: string): boolean {
	const t = normalize(text);
	return [
		"mi nombre es",
		"me llamo",
		"my name is",
		"call me",
		"I'm ",
		"i'm ",
		"soy ",
	].some((pattern) => t.startsWith(pattern) || ` ${t}`.includes(` ${pattern}`));
}

export function extractNameFromText(text: string): string | undefined {
	// Spanish patterns
	const esPatterns = [
		/mi nombre es\s+(.+)/i,
		/me llamo\s+(.+)/i,
		/soy\s+(.+)/i,
	];

	// English patterns
	const enPatterns = [
		/my name is\s+(.+)/i,
		/call me\s+(.+)/i,
		/i(?:'m| am)\s+(.+)/i,
	];

	const patterns = [...esPatterns, ...enPatterns];

	for (const pattern of patterns) {
		const match = text.match(pattern);
		if (match?.[1]) {
			let name = match[1].trim();
			// Clean up common trailing words
			name = name.replace(/,\s*(y|i).*$/i, "").trim();
			name = name.replace(/\s+(y|and)\s+.*$/i, "").trim();
			// Remove period at end
			name = name.replace(/\.$/, "").trim();
			if (name.length > 0) return name;
		}
	}

	return undefined;
}
