import * as nzbget from "./nzbget";
import * as plex from "./plex";
import * as qbittorrent from "./qbittorrent";
import * as radarr from "./radarr";
import * as sonarr from "./sonarr";

export type ServiceStatus = {
	service: string;
	online: boolean;
	message: string;
};

export async function pingBrain(): Promise<string> {
	const start = performance.now();
	let basePath = process.env.BRAIN_WEBHOOK_URL
		? process.env.BRAIN_WEBHOOK_URL.replace(/\/$/, "")
		: `http://127.0.0.1:${process.env.WEBHOOK_PORT || 3000}`;

	if (process.env.BRAIN_WEBHOOK_URL) {
		if (!basePath.startsWith("http")) basePath = `http://${basePath}`;
		if (!basePath.match(/:\d+$/)) basePath = `${basePath}:3000`;
	}

	const url = `${basePath}/health`;

	const res = await fetch(url, {
		method: "GET",
		signal: AbortSignal.timeout(5000),
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}`);

	const end = performance.now();
	return `${Math.round(end - start)}ms`;
}

export async function checkAllServices(): Promise<ServiceStatus[]> {
	const services = [
		{ name: "Brain", check: pingBrain },
		{ name: "Radarr", check: () => radarr.getSystemStatus() },
		{ name: "Sonarr", check: () => sonarr.getSystemStatus() },
		{ name: "Plex", check: () => plex.getSystemStatus() },
		{ name: "qBittorrent", check: () => qbittorrent.getTorrents("all") },
		{ name: "NZBGet", check: () => nzbget.getVersion() },
	];

	const results = await Promise.all(
		services.map(async (s) => {
			try {
				const checkResult = await s.check();
				let message = "Online";
				if (s.name === "Brain" && typeof checkResult === "string") {
					message = `Online (${checkResult})`;
				}
				return { service: s.name, online: true, message };
			} catch (error) {
				return { service: s.name, online: false, message: "Offline" };
			}
		}),
	);

	return results;
}
