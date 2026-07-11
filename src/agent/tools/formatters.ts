export function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / k ** i).toFixed(2)) + " " + sizes[i];
}

export function formatDuration(seconds: number): string {
	if (seconds <= 0 || seconds >= 8640000) return "N/A";
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	const remainingSecs = seconds % 60;
	if (minutes < 60) {
		return `${minutes}m ${remainingSecs}s`;
	}
	const hours = Math.floor(minutes / 60);
	const remainingMins = minutes % 60;
	if (hours < 24) {
		return `${hours}h ${remainingMins}m`;
	}
	const days = Math.floor(hours / 24);
	const remainingHours = hours % 24;
	return `${days}d ${remainingHours}h`;
}

export function getCompletionWallClock(seconds: number, tz: string): string {
	if (seconds <= 0 || seconds >= 8640000) return "";
	const completionDate = new Date(Date.now() + seconds * 1000);
	try {
		return completionDate.toLocaleTimeString("en-GB", {
			timeZone: tz,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
	} catch {
		return completionDate.toLocaleTimeString();
	}
}

export function formatEstimatedCompletion(
	estimatedCompletionTime: string | undefined,
	tz: string,
): string {
	if (!estimatedCompletionTime) return "N/A";
	const date = new Date(estimatedCompletionTime);
	if (isNaN(date.getTime())) return "N/A";
	const diffMs = date.getTime() - Date.now();
	if (diffMs <= 0) return "Completed";
	const seconds = Math.ceil(diffMs / 1000);
	const duration = formatDuration(seconds);
	try {
		const wallClock = date.toLocaleTimeString("en-GB", {
			timeZone: tz,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		return `${duration} (est. ${wallClock})`;
	} catch {
		return duration;
	}
}

export function hasNonLatinCharacters(value: string): boolean {
	return /[^\u0000-\u024f\s"'`~!@#$%^&*()\-_=+[\]{}\\|;:,./<>?0-9]/.test(value);
}

export function pickLatinAliasCandidate(
	candidates: Array<string | undefined>,
	title: string,
): string | undefined {
	const normalizedTitle = title.trim().toLowerCase();
	for (const raw of candidates) {
		const candidate = raw?.trim();
		if (!candidate) continue;
		if (candidate.toLowerCase() === normalizedTitle) continue;
		if (hasNonLatinCharacters(candidate)) continue;
		return candidate;
	}
	return undefined;
}

export function stripDiacritics(value: string): string {
	try {
		return value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
	} catch {
		return value;
	}
}

export function uniqueNonEmptyStrings(
	values: Array<string | undefined | null>,
): string[] {
	const unique = new Set<string>();
	for (const value of values) {
		const trimmed = typeof value === "string" ? value.trim() : "";
		if (!trimmed) continue;
		unique.add(trimmed);
	}
	return [...unique.values()];
}
