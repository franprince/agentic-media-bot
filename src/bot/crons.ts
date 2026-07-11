import cron, { type ScheduledTask } from "node-cron";
import { Bot } from "grammy";
import {
    getTimezone,
    getRecentMediaEvents,
    getAllReportSubscriptions,
    type ReportSubscription
} from "../services/database.ts";
import { getAllowedUserIdSet } from "./auth.ts";
import * as radarr from "../services/radarr";
import * as sonarr from "../services/sonarr";
import { formatBytes } from "../agent/tools/formatters.ts";
import { registerSubscriptionChangedCallback } from "../services/scheduler";

const activeReportCrons = new Map<number, ScheduledTask>();

export async function sendSummaryReport(bot: Bot<any, any>, userId: number, days: number = 7) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const radarrEvents = [
        ...getRecentMediaEvents("radarr", 100, sinceDate),
        ...getRecentMediaEvents("Radarr", 100, sinceDate)
    ];
    const sonarrEvents = [
        ...getRecentMediaEvents("sonarr", 100, sinceDate),
        ...getRecentMediaEvents("Sonarr", 100, sinceDate)
    ];

    if (radarrEvents.length === 0 && sonarrEvents.length === 0) {
        await bot.api.sendMessage(userId, `📊 *Summary Report (${days} days)*\n\nNo media activity was recorded during this period.`, { parse_mode: "Markdown" }).catch(e => {
            console.error(`Failed to send empty summary report to user ${userId}:`, e);
        });
        return;
    }

    let summary = `📊 *Summary Report (${days} days)*\n\n`;

    if (radarrEvents.length > 0) {
        summary += `🎬 *Radarr* (${radarrEvents.length} events)\n`;
        const grabs = radarrEvents.filter(e => e.event_type === "grab").length;
        const downloads = radarrEvents.filter(e => e.event_type === "download").length;
        summary += `▫️ Grabbed: ${grabs}\n▫️ Downloaded: ${downloads}\n\n`;
    }

    if (sonarrEvents.length > 0) {
        summary += `📺 *Sonarr* (${sonarrEvents.length} events)\n`;
        const grabs = sonarrEvents.filter(e => e.event_type === "grab").length;
        const downloads = sonarrEvents.filter(e => e.event_type === "download").length;
        summary += `▫️ Grabbed: ${grabs}\n▫️ Downloaded: ${downloads}\n\n`;
    }

    summary += `_You can manage immediate alerts with_\n\`/radarr alerts <grab|download> <on|off>\`\n\`/sonarr alerts <grab|download> <on|off>\``;

    await bot.api.sendMessage(userId, summary, { parse_mode: "Markdown" }).catch(e => {
        console.error(`Failed to send summary report to user ${userId}:`, e);
    });
}

export function reloadReportSubscriptions(bot: Bot<any, any>) {
    const tz = getTimezone();
    console.log(`⏰ Reloading dynamic report subscriptions with timezone: ${tz}`);

    for (const [id, task] of activeReportCrons.entries()) {
        try {
            task.stop();
        } catch (e) {
            console.error(`Failed to stop cron task ${id}:`, e);
        }
    }
    activeReportCrons.clear();

    let subs: ReportSubscription[] = [];
    try {
        subs = getAllReportSubscriptions();
    } catch (err: any) {
        console.error("Failed to load report subscriptions from database:", err.message);
        return;
    }

    for (const sub of subs) {
        try {
            if (!cron.validate(sub.cron_expression)) {
                console.warn(`⚠️ Invalid cron expression for subscription ID ${sub.id}: '${sub.cron_expression}'`);
                continue;
            }

            const task = cron.schedule(sub.cron_expression, async () => {
                console.log(`⏰ Executing scheduled report ID ${sub.id} (type: ${sub.report_type}) for user ${sub.user_id}`);
                if (sub.report_type === "summary") {
                    await sendSummaryReport(bot, sub.user_id, sub.days);
                }
            }, {
                timezone: tz
            });

            activeReportCrons.set(sub.id, task);
        } catch (err: any) {
            console.error(`Failed to schedule report subscription ID ${sub.id}:`, err.message);
        }
    }

    console.log(`✅ Loaded and scheduled ${activeReportCrons.size} report subscriptions.`);
}

export function startWeeklySummaryCron(bot: Bot<any, any>) {
    const tz = getTimezone();
    console.log(`⏰ Starting weekly summary cron with timezone: ${tz}`);
    cron.schedule("0 18 * * 5", async () => {
        const adminIds = getAllowedUserIdSet();
        if (adminIds.size === 0) return;

        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const radarrEvents = getRecentMediaEvents("radarr", 100, sevenDaysAgo);
        const sonarrEvents = getRecentMediaEvents("sonarr", 100, sevenDaysAgo);

        if (radarrEvents.length === 0 && sonarrEvents.length === 0) {
            return;
        }

        let summary = "📊 *Weekly Media Summary*\n\n";

        if (radarrEvents.length > 0) {
            summary += `🎬 *Radarr* (${radarrEvents.length} events)\n`;
            const grabs = radarrEvents.filter(e => e.event_type === "grab").length;
            const downloads = radarrEvents.filter(e => e.event_type === "download").length;
            summary += `▫️ Grabbed: ${grabs}\n▫️ Downloaded: ${downloads}\n\n`;
        }

        if (sonarrEvents.length > 0) {
            summary += `📺 *Sonarr* (${sonarrEvents.length} events)\n`;
            const grabs = sonarrEvents.filter(e => e.event_type === "grab").length;
            const downloads = sonarrEvents.filter(e => e.event_type === "download").length;
            summary += `▫️ Grabbed: ${grabs}\n▫️ Downloaded: ${downloads}\n\n`;
        }

        summary += `_You can manage immediate alerts with_\n\`/radarr alerts <grab|download> <on|off>\`\n\`/sonarr alerts <grab|download> <on|off>\``;

        for (const adminId of adminIds) {
            try {
                await bot.api.sendMessage(adminId, summary, { parse_mode: "Markdown" });
            } catch (err) {
                console.error(`Failed to send weekly summary to ${adminId}:`, err);
            }
        }
    }, {
        timezone: tz
    });
}

export function startStorageAlertCron(bot: Bot<any, any>) {
    const tz = getTimezone();
    console.log(`⏰ Starting daily storage alert cron with timezone: ${tz}`);
    cron.schedule("0 10 * * *", async () => {
        const adminIds = getAllowedUserIdSet();
        if (adminIds.size === 0) return;

        try {
            const radarrFolders = await radarr.getRootFolders().catch(() => []);
            const sonarrFolders = await sonarr.getRootFolders().catch(() => []);

            const lowSpaceFolders: Array<{ service: string; path: string; freeSpace: string }> = [];
            const thresholdBytes = 50 * 1024 * 1024 * 1024; // 50 GB

            radarrFolders.forEach(f => {
                if (f.freeSpace < thresholdBytes) {
                    lowSpaceFolders.push({ service: "Radarr", path: f.path, freeSpace: formatBytes(f.freeSpace) });
                }
            });

            sonarrFolders.forEach(f => {
                if (f.freeSpace < thresholdBytes) {
                    lowSpaceFolders.push({ service: "Sonarr", path: f.path, freeSpace: formatBytes(f.freeSpace) });
                }
            });

            if (lowSpaceFolders.length > 0) {
                let alertMessage = `⚠️ *Low Storage Warning!*\n\nThe following folders have less than 50 GB free:\n\n`;
                lowSpaceFolders.forEach(f => {
                    alertMessage += `▫️ *[${f.service}]* \`${f.path}\`: *${f.freeSpace}* free\n`;
                });

                for (const adminId of adminIds) {
                    try {
                        await bot.api.sendMessage(adminId, alertMessage, { parse_mode: "Markdown" });
                    } catch (err) {
                        console.error(`Failed to send storage alert to ${adminId}:`, err);
                    }
                }
            }
        } catch (error) {
            console.error("Failed running storage alert cron:", error);
        }
    }, {
        timezone: tz
    });
}

export function registerCrons(bot: Bot<any, any>) {
    startWeeklySummaryCron(bot);
    startStorageAlertCron(bot);
    reloadReportSubscriptions(bot);

    registerSubscriptionChangedCallback(() => {
        reloadReportSubscriptions(bot);
    });
}
