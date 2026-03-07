import * as radarr from "./radarr";
import * as sonarr from "./sonarr";
import * as plex from "./plex";
import * as qbittorrent from "./qbittorrent";
import * as nzbget from "./nzbget";

export type ServiceStatus = {
    service: string;
    online: boolean;
    message: string;
};

export async function pingBrain(): Promise<string> {
    const isOllama = process.env.AI_PROVIDER === "ollama";
    const start = performance.now();
    const url = isOllama ? (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434") : "https://generativelanguage.googleapis.com";

    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5000) });
    if (!res) throw new Error("No response");

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
        })
    );

    return results;
}
