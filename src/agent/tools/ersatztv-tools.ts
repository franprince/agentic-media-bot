import { tool } from "ai";
import { z } from "zod";
import * as mediaToolsClient from "../../services/media-tools-client";

export const getErsatzTVStatusTool = tool({
	description:
		"Get the status, server version, channel count, and active playouts of the ErsatzTV IPTV instance.",
	parameters: z.object({}),
	execute: async () => {
		try {
			const status = await mediaToolsClient.getErsatzTVStatus();
			if (!status.online) {
				return {
					online: false,
					message: "ErsatzTV server is currently offline or unreachable.",
				};
			}
			return {
				online: true,
				version: status.version,
				message: `ErsatzTV is online (v${status.version}).`,
			};
		} catch (error) {
			const err = error as Error;
			return {
				online: false,
				message: `Failed to fetch ErsatzTV status: ${err.message || "Unknown error"}`,
			};
		}
	},
});

export const getErsatzTVGuideTool = tool({
	description:
		"Get the daily Electronic Program Guide (EPG) schedule for ErsatzTV channels.",
	parameters: z.object({
		channelId: z
			.string()
			.optional()
			.describe("Optional specific ErsatzTV channel ID to get the guide for."),
		date: z
			.string()
			.optional()
			.describe(
				"Optional date in YYYY-MM-DD format (defaults to current date).",
			),
	}),
	execute: async ({ channelId, date }: { channelId?: string; date?: string }) => {
		try {
			const guide = await mediaToolsClient.getErsatzTVGuide(channelId, date);
			if (!guide.channels || guide.channels.length === 0) {
				return {
					date: guide.date,
					message: `No program guide available for ${guide.date}.`,
					channels: [],
				};
			}
			return {
				date: guide.date,
				channels: guide.channels.map((ch: any) => ({
					channelNumber: ch.number,
					channelName: ch.name,
					programCount: ch.programs ? ch.programs.length : 0,
					programs: (ch.programs || []).slice(0, 10).map((p: any) => ({
						title: p.title,
						subTitle: p.subTitle,
						start: p.start,
						end: p.end,
						durationMinutes: p.durationMinutes,
						type: p.type,
					})),
				})),
			};
		} catch (error) {
			const err = error as Error;
			return {
				message: `Failed to fetch daily guide: ${err.message || "Unknown error"}`,
			};
		}
	},
});

export const channelDirectorTool = tool({
	description:
		"Channel Director: Automatically configure or build custom IPTV channel programming in ErsatzTV based on filters (genres, show lists, year ranges, schedule blocks, slot durations).",
	parameters: z.object({
		channelName: z
			.string()
			.describe("Name of the custom channel to build or reconfigure."),
		channelNumber: z
			.string()
			.optional()
			.describe("Target IPTV channel number (e.g. '101')."),
		channelId: z
			.string()
			.optional()
			.describe("Existing ErsatzTV channel ID if updating an existing channel."),
		genres: z
			.array(z.string())
			.optional()
			.describe("List of genres to filter content by (e.g. ['Animation', 'Comedy'])."),
		showTitles: z
			.array(z.string())
			.optional()
			.describe(
				"List of specific TV show titles to include in the channel block.",
			),
		releaseYearMin: z
			.number()
			.optional()
			.describe("Minimum release year filter (e.g. 1990)."),
		releaseYearMax: z
			.number()
			.optional()
			.describe("Maximum release year filter (e.g. 1999)."),
		scheduleMode: z
			.enum(["block", "chronological", "random", "shuffle"])
			.default("block")
			.describe("Schedule playback mode."),
		slotDurationMinutes: z
			.number()
			.default(30)
			.describe("Standard slot duration in minutes for programming items."),
		includeFillers: z
			.boolean()
			.default(true)
			.describe("Whether to include commercial bumpers / filler media between slots."),
	}),
	execute: async ({
		channelName,
		channelNumber,
		channelId,
		genres,
		showTitles,
		releaseYearMin,
		releaseYearMax,
		scheduleMode,
		slotDurationMinutes,
		includeFillers,
	}: {
		channelName: string;
		channelNumber?: string;
		channelId?: string;
		genres?: string[];
		showTitles?: string[];
		releaseYearMin?: number;
		releaseYearMax?: number;
		scheduleMode: "block" | "chronological" | "random" | "shuffle";
		slotDurationMinutes: number;
		includeFillers: boolean;
	}) => {
		try {
			const result = await mediaToolsClient.createChannelDirectorProgramming({
				channelId,
				channelName,
				channelNumber,
				contentFilters: {
					genres,
					showTitles,
					releaseYearRange:
						releaseYearMin || releaseYearMax
							? { min: releaseYearMin, max: releaseYearMax }
							: undefined,
				},
				scheduleMode,
				slotDurationMinutes,
				includeFillers,
			});

			return {
				success: result.success,
				channelId: result.channelId,
				channelNumber: result.channelNumber,
				channelName: result.channelName,
				message: result.message,
			};
		} catch (error) {
			const err = error as Error;
			return {
				success: false,
				message: `Channel Director failed to program channel: ${err.message || "Unknown error"}`,
			};
		}
	},
});
