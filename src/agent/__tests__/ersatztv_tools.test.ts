import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as mediaToolsClient from "../../services/media-tools-client";
import {
	channelDirectorTool,
	getErsatzTVGuideTool,
	getErsatzTVStatusTool,
} from "../tools/ersatztv-tools";

describe("ErsatzTV AI Agent Tools", () => {
	test("getErsatzTVStatusTool returns online status and version summary", async () => {
		const spy = spyOn(mediaToolsClient, "getErsatzTVStatus").mockResolvedValue({
			online: true,
			version: "0.8.4",
		});

		const result = (await getErsatzTVStatusTool.execute(
			{},
			{ toolCallId: "test-call-1", messages: [] },
		)) as { online: boolean; version?: string };

		expect(result.online).toBeTrue();
		expect(result.version).toBe("0.8.4");
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	test("getErsatzTVGuideTool returns guide programs formatted for agent response", async () => {
		const spy = spyOn(mediaToolsClient, "getErsatzTVGuide").mockResolvedValue({
			date: "2026-08-06",
			channels: [
				{
					number: "101",
					name: "Classic Cartoons",
					programs: [
						{
							title: "Looney Tunes",
							start: "2026-08-06T10:00:00Z",
							end: "2026-08-06T10:30:00Z",
							durationMinutes: 30,
							type: "episode",
						},
					],
				},
			],
		});

		const result = (await getErsatzTVGuideTool.execute(
			{ date: "2026-08-06" },
			{ toolCallId: "test-call-2", messages: [] },
		)) as { date: string; channels: Array<{ channelNumber: string; programCount: number }> };

		expect(result.date).toBe("2026-08-06");
		expect(result.channels).toHaveLength(1);
		expect(result.channels[0].channelNumber).toBe("101");
		expect(result.channels[0].programCount).toBe(1);
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	test("channelDirectorTool executes successfully with parameters", async () => {
		const spy = spyOn(mediaToolsClient, "createChannelDirectorProgramming").mockResolvedValue({
			success: true,
			channelId: "chn-1",
			channelNumber: "102",
			channelName: "Anime Nights",
			scheduleId: "sch-1",
			playoutId: "ply-1",
			message: "Channel Anime Nights successfully configured on channel 102.",
		});

		const result = (await channelDirectorTool.execute(
			{
				channelName: "Anime Nights",
				channelNumber: "102",
				genres: ["Animation", "Action"],
				scheduleMode: "shuffle",
				slotDurationMinutes: 30,
				includeFillers: true,
			},
			{ toolCallId: "test-call-3", messages: [] },
		)) as { success: boolean; channelId: string; channelNumber: string };

		expect(result.success).toBeTrue();
		expect(result.channelId).toBe("chn-1");
		expect(result.channelNumber).toBe("102");
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});
