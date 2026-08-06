import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { HttpResponse, http } from "msw";
import { server } from "../../mocks/server";
import * as ersatztv from "../ersatztv";

beforeAll(() => {
	process.env.ERSATZTV_URL = "http://localhost:8409";
	process.env.ERSATZTV_API_KEY = "test_key";
});

afterEach(() => {
	server.resetHandlers();
});

describe("ErsatzTV Service", () => {
	test("getSystemStatus returns online and version when server responds", async () => {
		server.use(
			http.get("http://localhost:8409/api/version", () => {
				return HttpResponse.json({ version: "0.8.4" });
			}),
		);

		const status = await ersatztv.getSystemStatus();
		expect(status.online).toBeTrue();
		expect(status.version).toBe("0.8.4");
	});

	test("getChannels returns list of configured channels", async () => {
		server.use(
			http.get("http://localhost:8409/api/v2/channels", () => {
				return HttpResponse.json([
					{ id: "1", number: "101", name: "90s Cartoons" },
					{ id: "2", number: "102", name: "Sci-Fi Night" },
				]);
			}),
		);

		const channels = await ersatztv.getChannels();
		expect(channels).toHaveLength(2);
		expect(channels[0].name).toBe("90s Cartoons");
		expect(channels[1].number).toBe("102");
	});

	test("getDailyGuide retrieves guide items for specified date", async () => {
		server.use(
			http.get("http://localhost:8409/api/v2/channels/guide", () => {
				return HttpResponse.json([
					{
						id: "1",
						number: "101",
						name: "90s Cartoons",
						programs: [
							{
								id: "p1",
								title: "Batman: The Animated Series",
								start: "2026-08-06T09:00:00Z",
								end: "2026-08-06T09:30:00Z",
								durationMinutes: 30,
								channelNumber: "101",
								channelName: "90s Cartoons",
								type: "episode",
							},
						],
					},
				]);
			}),
		);

		const guide = await ersatztv.getDailyGuide(undefined, "2026-08-06");
		expect(guide.date).toBe("2026-08-06");
		expect(guide.channels).toHaveLength(1);
		expect(guide.channels[0].programs[0].title).toBe(
			"Batman: The Animated Series",
		);
	});

	test("createChannelDirectorProgramming configures smart collection, schedule, channel, and playout", async () => {
		server.use(
			http.post("http://localhost:8409/api/v2/collections/smart", () => {
				return HttpResponse.json({ id: "col-123" });
			}),
			http.post("http://localhost:8409/api/v2/schedules", () => {
				return HttpResponse.json({ id: "sched-456" });
			}),
			http.post("http://localhost:8409/api/v2/channels", () => {
				return HttpResponse.json({ id: "chan-789", number: "105" });
			}),
			http.post("http://localhost:8409/api/v2/playouts", () => {
				return HttpResponse.json({ id: "playout-999" });
			}),
		);

		const result = await ersatztv.createChannelDirectorProgramming({
			channelName: "Retro Sci-Fi",
			channelNumber: "105",
			contentFilters: { genres: ["Sci-Fi"], releaseYearRange: { min: 1980, max: 1999 } },
			scheduleMode: "block",
			slotDurationMinutes: 60,
			includeFillers: true,
		});

		expect(result.success).toBeTrue();
		expect(result.channelId).toBe("chan-789");
		expect(result.channelNumber).toBe("105");
		expect(result.scheduleId).toBe("sched-456");
		expect(result.playoutId).toBe("playout-999");
	});
});
