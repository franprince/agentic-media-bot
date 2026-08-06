import { executeOnProxy, isProxyEnabled } from "../agent/proxyClient";
import type {
	ChannelDirectorParams,
	ChannelDirectorResult,
	ErsatzTVChannel,
	ErsatzTVDailyGuide,
	ErsatzTVPlayout,
	ErsatzTVSchedule,
} from "../types/ersatztv";
import { AppError, handleApiError } from "../utils/errors";
import { fetchService, type FetchOptions } from "./api";

async function fetchErsatzTV<T>(
	endpoint: string,
	options: FetchOptions = {},
): Promise<T> {
	if (isProxyEnabled()) {
		const caller = new Error().stack?.split("\n")[2]?.trim() || "";
		const methodName =
			caller.match(/at\s+(?:async\s+)?(\w+)/)?.[1] || "unknown";
		if (methodName !== "fetchErsatzTV") {
			return executeOnProxy(
				"ersatztv",
				methodName,
				options.body ? [JSON.parse(options.body as string)] : [],
			);
		}
	}

	const baseUrl =
		process.env.ERSATZTV_URL?.trim() || "http://localhost:8409";
	const apiKey = process.env.ERSATZTV_API_KEY?.trim() || "none";

	return fetchService<T>(baseUrl, endpoint, "X-Api-Key", apiKey, options);
}

export async function getSystemStatus(): Promise<{
	online: boolean;
	version: string;
}> {
	if (isProxyEnabled()) {
		return executeOnProxy("ersatztv", "getSystemStatus", []);
	}

	try {
		const status = await fetchErsatzTV<{ version?: string }>("/api/version");
		return {
			online: true,
			version: status.version || "1.0.0",
		};
	} catch (error) {
		const baseUrl =
			process.env.ERSATZTV_URL?.trim() || "http://localhost:8409";
		const res = await fetch(`${baseUrl}/api/version`, {
			signal: AbortSignal.timeout(5000),
		}).catch(() => null);

		if (res && res.ok) {
			const data = (await res.json().catch(() => ({}))) as { version?: string };
			return { online: true, version: data.version || "1.0.0" };
		}

		return { online: false, version: "Offline" };
	}
}

export async function getChannels(): Promise<ErsatzTVChannel[]> {
	if (isProxyEnabled()) {
		return executeOnProxy("ersatztv", "getChannels", []);
	}
	return fetchErsatzTV<ErsatzTVChannel[]>("/api/v2/channels");
}

export async function getDailyGuide(
	channelId?: string,
	date?: string,
): Promise<ErsatzTVDailyGuide> {
	if (isProxyEnabled()) {
		return executeOnProxy("ersatztv", "getDailyGuide", [channelId, date]);
	}

	const formattedDate = date || new Date().toISOString().split("T")[0];
	const endpoint = channelId
		? `/api/v2/channels/${channelId}/guide?date=${formattedDate}`
		: `/api/v2/channels/guide?date=${formattedDate}`;

	try {
		const channelsGuide = await fetchErsatzTV<ErsatzTVDailyGuide["channels"]>(
			endpoint,
		);
		return {
			date: formattedDate,
			channels: Array.isArray(channelsGuide) ? channelsGuide : [],
		};
	} catch (error) {
		return {
			date: formattedDate,
			channels: [],
		};
	}
}

export async function getPlayouts(): Promise<ErsatzTVPlayout[]> {
	if (isProxyEnabled()) {
		return executeOnProxy("ersatztv", "getPlayouts", []);
	}
	return fetchErsatzTV<ErsatzTVPlayout[]>("/api/v2/playouts");
}

export async function getSchedules(): Promise<ErsatzTVSchedule[]> {
	if (isProxyEnabled()) {
		return executeOnProxy("ersatztv", "getSchedules", []);
	}
	return fetchErsatzTV<ErsatzTVSchedule[]>("/api/v2/schedules");
}

export async function createChannelDirectorProgramming(
	params: ChannelDirectorParams,
): Promise<ChannelDirectorResult> {
	if (isProxyEnabled()) {
		return executeOnProxy("ersatztv", "createChannelDirectorProgramming", [
			params,
		]);
	}

	try {
		const collectionRes = await fetchErsatzTV<{ id: string }>(
			"/api/v2/collections/smart",
			{
				method: "POST",
				body: JSON.stringify({
					name: `${params.channelName} Collection`,
					query: params.contentFilters,
				}),
			},
		);

		const scheduleRes = await fetchErsatzTV<{ id: string }>(
			"/api/v2/schedules",
			{
				method: "POST",
				body: JSON.stringify({
					name: `${params.channelName} Schedule`,
					mode: params.scheduleMode,
					slotDurationMinutes: params.slotDurationMinutes || 30,
					collectionId: collectionRes.id,
					includeFillers: params.includeFillers ?? true,
				}),
			},
		);

		const channelRes = await fetchErsatzTV<{ id: string; number: string }>(
			params.channelId
				? `/api/v2/channels/${params.channelId}`
				: "/api/v2/channels",
			{
				method: params.channelId ? "PUT" : "POST",
				body: JSON.stringify({
					name: params.channelName,
					number: params.channelNumber || "100",
					watermarkId: params.watermarkId,
				}),
			},
		);

		const playoutRes = await fetchErsatzTV<{ id: string }>("/api/v2/playouts", {
			method: "POST",
			body: JSON.stringify({
				channelId: channelRes.id,
				scheduleId: scheduleRes.id,
			}),
		});

		return {
			success: true,
			channelId: channelRes.id,
			channelNumber: channelRes.number,
			channelName: params.channelName,
			scheduleId: scheduleRes.id,
			playoutId: playoutRes.id,
			message: `Channel ${params.channelName} successfully configured on channel ${channelRes.number}.`,
		};
	} catch (error) {
		const err = error as Error;
		throw handleApiError(err, "ersatztv", {
			method: "POST",
			url: "/api/v2/channels",
		});
	}
}
