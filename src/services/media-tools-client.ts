import { executeOnProxy, isProxyEnabled } from "../agent/proxyClient";
import * as ollamaClassifier from "./ollamaClassifier";
import type { IntentClassification } from "./ollamaClassifier";

export async function checkServiceHealth(service: string): Promise<{ online: boolean }> {
	if (isProxyEnabled())
		return executeOnProxy("mediaTools", "checkServiceHealth", [service]);
	const { ServiceHealthManager } = await import("media-tools");
	return new ServiceHealthManager().checkServiceHealth(service);
}

export async function getDiskSpace(): Promise<
	Array<{ service: string; path: string; freeBytes: number }>
> {
	if (isProxyEnabled()) return executeOnProxy("mediaTools", "getDiskSpace", []);
	const { ServiceHealthManager } = await import("media-tools");
	return new ServiceHealthManager().getDiskSpace();
}

export async function getTorrents(filter?: string): Promise<any[]> {
	if (isProxyEnabled())
		return executeOnProxy("mediaTools", "getTorrents", [filter]);
	const { DownloadQueueManager } = await import("media-tools");
	return new DownloadQueueManager().getTorrents(filter);
}

export async function pauseTorrent(hash: string): Promise<void> {
	if (isProxyEnabled()) return executeOnProxy("mediaTools", "pauseTorrent", [hash]);
	const { DownloadQueueManager } = await import("media-tools");
	return new DownloadQueueManager().pauseTorrent(hash);
}

export async function resumeTorrent(hash: string): Promise<void> {
	if (isProxyEnabled())
		return executeOnProxy("mediaTools", "resumeTorrent", [hash]);
	const { DownloadQueueManager } = await import("media-tools");
	return new DownloadQueueManager().resumeTorrent(hash);
}

export async function pauseAllTorrents(): Promise<void> {
	if (isProxyEnabled()) return executeOnProxy("mediaTools", "pauseAllTorrents", []);
	const { DownloadQueueManager } = await import("media-tools");
	return new DownloadQueueManager().pauseAllTorrents();
}

export async function resumeAllTorrents(): Promise<void> {
	if (isProxyEnabled()) return executeOnProxy("mediaTools", "resumeAllTorrents", []);
	const { DownloadQueueManager } = await import("media-tools");
	return new DownloadQueueManager().resumeAllTorrents();
}

export async function getNZBGetQueue(): Promise<{ queue: any[]; status: any }> {
	if (isProxyEnabled()) return executeOnProxy("mediaTools", "getNZBGetQueue", []);
	const { DownloadQueueManager } = await import("media-tools");
	return new DownloadQueueManager().getNZBGetQueue();
}

export async function classifyIntent(message: string): Promise<IntentClassification> {
	if (isProxyEnabled())
		return executeOnProxy("mediaTools", "classifyIntent", [message]);
	return ollamaClassifier.classifyIntent(message);
}

export async function getErsatzTVStatus(): Promise<{ online: boolean; version: string }> {
	if (isProxyEnabled()) return executeOnProxy("mediaTools", "getErsatzTVStatus", []);
	const { ErsatzTVManager } = await import("media-tools");
	return new ErsatzTVManager().getSystemStatus();
}

export async function getErsatzTVGuide(channelId?: string, date?: string): Promise<any> {
	if (isProxyEnabled())
		return executeOnProxy("mediaTools", "getErsatzTVGuide", [channelId, date]);
	const { ErsatzTVManager } = await import("media-tools");
	return new ErsatzTVManager().getDailyGuide(channelId, date);
}

export async function createChannelDirectorProgramming(params: any): Promise<any> {
	if (isProxyEnabled())
		return executeOnProxy("mediaTools", "createChannelDirectorProgramming", [params]);
	const { ErsatzTVManager } = await import("media-tools");
	return new ErsatzTVManager().createChannelDirectorProgramming(params);
}

