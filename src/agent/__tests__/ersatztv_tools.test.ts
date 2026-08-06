import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { server } from "../../mocks/server";
import {
	channelDirectorTool,
	getErsatzTVGuideTool,
	getErsatzTVStatusTool,
} from "../tools/ersatztv-tools";

beforeAll(() => {
	process.env.ERSATZTV_URL = "http://localhost:8409";
	process.env.ERSATZTV_API_KEY = "test_key";
});

afterEach(() => {
	server.resetHandlers();
});

describe("ErsatzTV AI Agent Tools", () => {
	test("getErsatzTVStatusTool returns online status and channel summary", async () => {
		server.use(
			http.get("http://localhost:8409/api/version", () => {
				return HttpResponse.json({ version: "0.8.4" });
			}),
			http.get("http://localhost:8409/api/v2/channels", () => {
				return HttpResponse.json([
					{ id: "c1", number: "101", name: "Classic Cartoons" },
				]);
			}),
			http.get("http://localhost:8409/api/v2/playouts", () => {
				return HttpResponse.json([
					{ id: "p1", channelId: "c1", channelNumber: "101", channelName: "Classic Cartoons" },
				]);
			}),
		);

		const result = (await getErsatzTVStatusTool.execute(
			{},
			{ toolCallId: "test-call-1", messages: [] },
		)) as { online: boolean; version?: string; channelCount?: number };

		expect(result.online).toBeTrue();
		expect(result.version).toBe("0.8.4");
		expect(result.channelCount).toBe(1);
	});

	test("getErsatzTVGuideTool returns guide programs formatted for agent response", async () => {
		server.use(
			http.get("http://localhost:8409/api/v2/channels/guide", () => {
				return HttpResponse.json([
					{
						id: "c1",
						number: "101",
						name: "Classic Cartoons",
						programs: [
							{
								id: "prg1",
								title: "Looney Tunes",
								start: "2026-08-06T10:00:00Z",
								end: "2026-08-06T10:30:00Z",
								durationMinutes: 30,
								type: "episode",
							},
						],
					},
				]);
			}),
		);

		const result = (await getErsatzTVGuideTool.execute(
			{ date: "2026-08-06" },
			{ toolCallId: "test-call-2", messages: [] },
		)) as { date: string; channels: Array<{ channelNumber: string; programCount: number }> };

		expect(result.date).toBe("2026-08-06");
		expect(result.channels).toHaveLength(1);
		expect(result.channels[0].channelNumber).toBe("101");
		expect(result.channels[0].programCount).toBe(1);
	});

	test("channelDirectorTool executes successfully with parameters", async () => {
		server.use(
			http.post("http://localhost:8409/api/v2/collections/smart", () => {
				return HttpResponse.json({ id: "col-1" });
			}),
			http.post("http://localhost:8409/api/v2/schedules", () => {
				return HttpResponse.json({ id: "sch-1" });
			}),
			http.post("http://localhost:8409/api/v2/channels", () => {
				return HttpResponse.json({ id: "chn-1", number: "102" });
			}),
			http.post("http://localhost:8409/api/v2/playouts", () => {
				return HttpResponse.json({ id: "ply-1" });
			}),
		);

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
	});
});
