import { executeOnProxy, isProxyEnabled } from "../agent/proxyClient";
import type { RadarrMovie, RadarrQueueItem } from "../types/radarr";
import { fetchService } from "./api";

async function fetchRadarr<T>(endpoint: string, options: any = {}): Promise<T> {
	const baseUrl = process.env.RADARR_URL?.trim() || "";
	const apiKey = process.env.RADARR_API_KEY?.trim() || "";

	return fetchService<T>(
		baseUrl,
		`/api/v3${endpoint}`,
		"apikey",
		apiKey,
		options,
	);
}

export async function searchMovie(term: string): Promise<RadarrMovie[]> {
	if (isProxyEnabled()) return executeOnProxy("radarr", "searchMovie", [term]);
	return fetchRadarr<RadarrMovie[]>(
		`/movie/lookup?term=${encodeURIComponent(term)}`,
	);
}

/**
 * Add a movie to Radarr.
 * Usually requires rootFolderPath and qualityProfileId to be set from your Radarr instance.
 */
export async function addMovie(
	tmdbId: number,
	title: string,
	year: number,
	rootFolderPath: string,
	qualityProfileId: number,
	tags?: number[],
): Promise<RadarrMovie> {
	if (isProxyEnabled())
		return executeOnProxy("radarr", "addMovie", [
			tmdbId,
			title,
			year,
			rootFolderPath,
			qualityProfileId,
			tags,
		]);
	const allMovies = await fetchRadarr<RadarrMovie[]>("/movie");
	const existing = allMovies.find((m) => m.tmdbId === tmdbId);
	if (existing) {
		return existing; // Already exists, return current record
	}

	const payload = {
		title,
		qualityProfileId,
		year,
		tmdbId,
		rootFolderPath,
		monitored: true,
		addOptions: {
			searchForMovie: true,
		},
		tags: tags || [],
	};

	return fetchRadarr<RadarrMovie>("/movie", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

/**
 * Get the current activity queue.
 */
export async function getMovieQueue(): Promise<RadarrQueueItem[]> {
	if (isProxyEnabled()) return executeOnProxy("radarr", "getMovieQueue");
	const result = await fetchRadarr<{ records: RadarrQueueItem[] }>("/queue");
	return result.records;
}

/**
 * Get the root folders configured in Radarr (needed for adding movies).
 */
export async function getRootFolders(): Promise<
	Array<{ id: number; path: string; freeSpace: number }>
> {
	if (isProxyEnabled()) return executeOnProxy("radarr", "getRootFolders");
	return fetchRadarr("/rootfolder");
}

/**
 * Get the quality profiles configured in Radarr (needed for adding movies).
 */
export async function getQualityProfiles(): Promise<
	Array<{ id: number; name: string }>
> {
	if (isProxyEnabled()) return executeOnProxy("radarr", "getQualityProfiles");
	return fetchRadarr("/qualityprofile");
}

/**
 * Get Radarr system status.
 */
export async function getSystemStatus(): Promise<any> {
	if (isProxyEnabled()) return executeOnProxy("radarr", "getSystemStatus");
	return fetchRadarr<any>("/system/status");
}

/**
 * Get movies that are monitored but missing files.
 */
export async function getMissingMovies(): Promise<RadarrMovie[]> {
	if (isProxyEnabled()) return executeOnProxy("radarr", "getMissingMovies");
	const movies = await fetchRadarr<RadarrMovie[]>("/movie");
	return movies.filter((m) => m.monitored && !m.hasFile);
}

/**
 * Delete a movie from Radarr.
 */
export async function deleteMovie(
	id: number,
	deleteFiles: boolean = false,
): Promise<void> {
	if (isProxyEnabled())
		return executeOnProxy("radarr", "deleteMovie", [id, deleteFiles]);
	await fetchRadarr(`/movie/${id}?deleteFiles=${deleteFiles}`, {
		method: "DELETE",
	});
}

export async function getTags(): Promise<Array<{ id: number; label: string }>> {
	if (isProxyEnabled()) return executeOnProxy("radarr", "getTags", []);
	return fetchRadarr<Array<{ id: number; label: string }>>("/tag");
}

export async function createTag(
	label: string,
): Promise<{ id: number; label: string }> {
	if (isProxyEnabled()) return executeOnProxy("radarr", "createTag", [label]);
	return fetchRadarr<{ id: number; label: string }>("/tag", {
		method: "POST",
		body: JSON.stringify({ label }),
	});
}

export async function resolveTagIds(labels: string[]): Promise<number[]> {
	if (isProxyEnabled())
		return executeOnProxy("radarr", "resolveTagIds", [labels]);
	if (!labels || labels.length === 0) return [];

	const existingTags = await getTags();
	const tagIds: number[] = [];

	for (const label of labels) {
		const cleaned = label.trim().toLowerCase();
		if (!cleaned) continue;

		const match = existingTags.find((t) => t.label.toLowerCase() === cleaned);
		if (match) {
			tagIds.push(match.id);
		} else {
			try {
				const newTag = await createTag(cleaned);
				tagIds.push(newTag.id);
			} catch (err: any) {
				console.error(`Failed to create Radarr tag "${cleaned}":`, err.message);
			}
		}
	}
	return tagIds;
}
