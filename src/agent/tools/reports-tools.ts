import { tool } from "ai";
import { z } from "zod";
import * as db from "../../services/database";
import { notifySubscriptionChanged } from "../../services/scheduler";

export const subscribeToDownloadTool = tool({
    description: "Subscribe a user to receive a Telegram notification when a specific movie or series download finishes. Use this ONLY after the user has confirmed they want to be notified.",
    parameters: z.object({
        userId: z.number().describe("The Telegram user ID of the person to notify."),
        mediaType: z.enum(["movie", "series"]).describe("The type of media (movie or series)."),
        mediaId: z.number().describe("The TMDB ID (for movies) or TVDB ID (for series)."),
        title: z.string().describe("The title of the media item."),
    }),
    execute: async ({ userId, mediaType, mediaId, title }: { userId: number, mediaType: 'movie' | 'series', mediaId: number, title: string }) => {
        try {
            db.savePendingNotification(userId, mediaType, mediaId, title);
            return {
                success: true,
                message: `Perfect! I'll send you a Telegram message as soon as '${title}' finishes downloading. 📡🎬`
            };
        } catch (error: any) {
            return { message: `Failed to register notification request: ${error.message || "Unknown error"}` };
        }
    },
});

export const subscribeToReportTool = tool({
    description: "Subscribe a user to receive recurring summary reports (e.g. daily, weekly) containing recent library additions. Supported type: 'summary'. Requires a valid cron expression.",
    parameters: z.object({
        userId: z.number().describe("The Telegram user ID to receive the reports."),
        reportType: z.enum(["summary"]).describe("The type of report to subscribe to."),
        cronExpression: z.string().describe("Standard cron expression for the report schedule (e.g., '0 9 * * *' for daily at 9:00 AM, '0 18 * * 5' for weekly on Fridays at 6:00 PM)."),
        days: z.number().default(7).describe("The lookback period in days for the summary content (e.g. 1 for daily, 7 for weekly)."),
    }),
    execute: async ({ userId, reportType, cronExpression, days }: { userId: number, reportType: 'summary', cronExpression: string, days: number }) => {
        try {
            // Basic validation of cron expression using node-cron.validate
            const cron = await import("node-cron");
            if (!cron.validate(cronExpression)) {
                return { message: "Invalid cron expression format. Please provide a standard 5-field cron syntax." };
            }

            const subscriptionId = db.addReportSubscription(userId, reportType, cronExpression, days);
            notifySubscriptionChanged();

            return {
                success: true,
                message: `✅ Successfully subscribed to a recurring ${reportType} report! Subscription ID: ${subscriptionId}. Next run will execute on schedule: '${cronExpression}'.`
            };
        } catch (error: any) {
            return { message: `Failed to create report subscription: ${error.message || "Unknown error"}` };
        }
    }
});

export const unsubscribeFromReportTool = tool({
    description: "Unsubscribe a user from a recurring report subscription using the subscription ID.",
    parameters: z.object({
        subscriptionId: z.number().describe("The ID of the report subscription to delete."),
    }),
    execute: async ({ subscriptionId }: { subscriptionId: number }) => {
        try {
            db.removeReportSubscription(subscriptionId);
            notifySubscriptionChanged();

            return {
                success: true,
                message: `✅ Successfully removed report subscription ID: ${subscriptionId}.`
            };
        } catch (error: any) {
            return { message: `Failed to cancel report subscription: ${error.message || "Unknown error"}` };
        }
    }
});

export const getReportSubscriptionsTool = tool({
    description: "List all active recurring report subscriptions for a user.",
    parameters: z.object({
        userId: z.number().describe("The Telegram user ID to query."),
    }),
    execute: async ({ userId }: { userId: number }) => {
        try {
            const list = db.getReportSubscriptions(userId);
            if (list.length === 0) {
                return { message: "You don't have any active report subscriptions." };
            }
            return {
                subscriptions: list.map(item => ({
                    id: item.id,
                    reportType: item.report_type,
                    cronExpression: item.cron_expression,
                    days: item.days,
                    createdAt: item.created_at
                }))
            };
        } catch (error: any) {
            return { message: `Failed to list report subscriptions: ${error.message || "Unknown error"}` };
        }
    }
});
