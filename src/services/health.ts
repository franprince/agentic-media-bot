import * as radarr from "./radarr";
import * as sonarr from "./sonarr";
import * as plex from "./plex";
import * as qbittorrent from "./qbittorrent";

export type ServiceStatus = {
    service: string;
    online: boolean;
    message: string;
};

export async function checkAllServices(): Promise<ServiceStatus[]> {
    const services = [
        { name: "Radarr", check: () => radarr.getSystemStatus() },
        { name: "Sonarr", check: () => sonarr.getSystemStatus() },
        { name: "Plex", check: () => plex.getSystemStatus() },
        { name: "qBittorrent", check: () => qbittorrent.getTorrents("all") },
    ];

    const results = await Promise.all(
        services.map(async (s) => {
            try {
                await s.check();
                return { service: s.name, online: true, message: "Online" };
            } catch (error) {
                return { service: s.name, online: false, message: "Offline" };
            }
        })
    );

    return results;
}
