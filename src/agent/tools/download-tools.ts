import { tool } from "ai";
import { z } from "zod";
import * as qbittorrent from "../../services/qbittorrent";
import * as nzbget from "../../services/nzbget";
import * as db from "../../services/database";
import { formatBytes, formatDuration, getCompletionWallClock, formatEstimatedCompletion } from "./formatters";

export const getTorrentsTool = tool({
    description: "Get a list of active torrents downloading or seeding in qBittorrent.",
    parameters: z.object({
        filter: z.enum(["all", "downloading", "seeding", "paused", "active"]).optional().describe("Filter for the list of torrents."),
    }),
    execute: async ({ filter = "downloading" }: { filter?: string }) => {
        try {
            const torrents = await qbittorrent.getTorrents(filter);
            if (torrents.length === 0) {
                return { message: `No torrents found with filter: ${filter}` };
            }
            const tz = db.getTimezone();
            return torrents.map(t => {
                const etaSeconds = typeof t.eta === "number" ? t.eta : 0;
                const etaHuman = etaSeconds > 0 && etaSeconds < 8640000
                    ? `${formatDuration(etaSeconds)} (est. ${getCompletionWallClock(etaSeconds, tz)})`
                    : "N/A";
                return {
                    name: t.name,
                    hash: t.hash,
                    progress: (t.progress * 100).toFixed(2) + "%",
                    etaSeconds: t.eta,
                    etaHuman,
                    state: t.state,
                    dlspeed: (t.dlspeed / 1024 / 1024).toFixed(2) + " MB/s" // Convert bytes to MB/s
                };
            });
        } catch (error: any) {
            return { message: `Failed to fetch torrents from qBittorrent: ${error.message || "Unknown error"}` };
        }
    },
});

export const pauseTorrentTool = tool({
    description: "Pause a specific torrent by its hash.",
    parameters: z.object({
        hash: z.string().describe("The hash of the torrent to pause."),
    }),
    execute: async ({ hash }: { hash: string }) => {
        try {
            await qbittorrent.pauseTorrent(hash);
            return { message: `Successfully paused torrent with hash ${hash}` };
        } catch (error: any) {
            return { message: `Failed to pause torrent: ${error.message || "Unknown error"}` };
        }
    },
});

export const resumeTorrentTool = tool({
    description: "Resume a specific torrent by its hash.",
    parameters: z.object({
        hash: z.string().describe("The hash of the torrent to resume."),
    }),
    execute: async ({ hash }: { hash: string }) => {
        try {
            await qbittorrent.resumeTorrent(hash);
            return { message: `Successfully resumed torrent with hash ${hash}` };
        } catch (error: any) {
            return { message: `Failed to resume torrent: ${error.message || "Unknown error"}` };
        }
    },
});

export const pauseAllTorrentsTool = tool({
    description: "Pause ALL active torrents in qBittorrent at once. Use when the user says 'pause everything', 'stop all downloads', or similar broad commands.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        try {
            await qbittorrent.pauseAllTorrents();
            return { message: "✅ All torrents have been paused successfully." };
        } catch (error: any) {
            return { message: `Failed to pause all torrents: ${error.message || "Unknown error"}` };
        }
    },
});

export const resumeAllTorrentsTool = tool({
    description: "Resume ALL paused torrents in qBittorrent at once. Use when the user says 'resume everything', 'start all downloads', or similar broad commands.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        try {
            await qbittorrent.resumeAllTorrents();
            return { message: "✅ All torrents have been resumed successfully." };
        } catch (error: any) {
            return { message: `Failed to resume all torrents: ${error.message || "Unknown error"}` };
        }
    },
});

export const getNZBGetQueueTool = tool({
    description: "Get the current download queue from NZBGet, including speed and ETA for active downloads.",
    parameters: z.object({}),
    execute: async (_args: any) => {
        try {
            const [queue, status] = await Promise.all([
                nzbget.getQueue(),
                nzbget.getStatus()
            ]);

            if (queue && queue.length === 0) {
                return { message: "The NZBGet queue is empty." };
            }

            const activeDownloads = queue.map((q: any) => {
                const fileSize = (q.FileSizeMB || 0) * 1024 * 1024;
                const remainingSize = (q.RemainingSizeMB || 0) * 1024 * 1024;
                const downloaded = Math.max(0, fileSize - remainingSize);
                return {
                    nzbName: q.NZBName,
                    fileSize: formatBytes(fileSize),
                    remainingSize: formatBytes(remainingSize),
                    downloaded: formatBytes(downloaded),
                    percentage: q.PercentageSuccess + "%",
                    status: q.Status
                };
            });

            const tz = db.getTimezone();
            const etaSeconds = status.ETA || 0;
            const etaHuman = etaSeconds > 0 && etaSeconds < 8640000
                ? `${formatDuration(etaSeconds)} (est. ${getCompletionWallClock(etaSeconds, tz)})`
                : "N/A";

            return {
                activeDownloads,
                globalStatus: {
                    downloadRate: (status.DownloadRate / 1024 / 1024).toFixed(2) + " MB/s",
                    remainingSize: formatBytes((status.RemainingSizeMB || 0) * 1024 * 1024),
                    eta: etaHuman,
                    isPaused: status.DownloadPaused
                }
            };
        } catch (error: any) {
            return { message: `Failed to fetch NZBGet status: ${error.message}` };
        }
    },
});
