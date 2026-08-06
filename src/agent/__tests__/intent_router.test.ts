import { afterEach, describe, expect, it, spyOn } from "bun:test";
import * as mediaToolsClient from "../../services/media-tools-client";
import { narrowToolsForMessage } from "../intentRouter";

function makeFullToolSet() {
	return {
		checkServiceHealth: { description: "check" },
		getDiskSpace: { description: "disk" },
		getTorrents: { description: "torrents" },
		pauseTorrent: { description: "pause" },
		resumeTorrent: { description: "resume" },
		pauseAllTorrents: { description: "pauseAll" },
		resumeAllTorrents: { description: "resumeAll" },
		getNZBGetQueue: { description: "nzbget" },
		searchMovie: { description: "unrelated tool" },
		addMovie: { description: "unrelated tool" },
	};
}

describe("narrowToolsForMessage", () => {
	afterEach(() => {
		// spies are restored per-test via mockRestore below
	});

	it("narrows to service-health tools on a confident service-health match", async () => {
		const spy = spyOn(mediaToolsClient, "classifyIntent").mockResolvedValue({
			domain: "service-health",
			confidence: 0.9,
		});
		const fullSet = makeFullToolSet();

		const result = await narrowToolsForMessage("is sonarr up?", fullSet);

		expect(Object.keys(result).sort()).toEqual(["checkServiceHealth", "getDiskSpace"]);
		spy.mockRestore();
	});

	it("narrows to download-queue tools on a confident download-queue match", async () => {
		const spy = spyOn(mediaToolsClient, "classifyIntent").mockResolvedValue({
			domain: "download-queue",
			confidence: 0.8,
		});
		const fullSet = makeFullToolSet();

		const result = await narrowToolsForMessage("pause all torrents", fullSet);

		expect(Object.keys(result).sort()).toEqual(
			[
				"getNZBGetQueue",
				"getTorrents",
				"pauseAllTorrents",
				"pauseTorrent",
				"resumeAllTorrents",
				"resumeTorrent",
			].sort(),
		);
		spy.mockRestore();
	});

	it("returns the full tool set unchanged when there is no domain match", async () => {
		const spy = spyOn(mediaToolsClient, "classifyIntent").mockResolvedValue({
			domain: null,
			confidence: 0,
		});
		const fullSet = makeFullToolSet();

		const result = await narrowToolsForMessage("what's the weather", fullSet);

		expect(result).toBe(fullSet);
		spy.mockRestore();
	});

	it("returns the full tool set unchanged when confidence is below the threshold", async () => {
		const spy = spyOn(mediaToolsClient, "classifyIntent").mockResolvedValue({
			domain: "service-health",
			confidence: 0.4,
		});
		const fullSet = makeFullToolSet();

		const result = await narrowToolsForMessage("is sonarr maybe up?", fullSet);

		expect(result).toBe(fullSet);
		spy.mockRestore();
	});

	it("fails open to the full tool set when classifyIntent throws", async () => {
		const spy = spyOn(mediaToolsClient, "classifyIntent").mockRejectedValue(
			new Error("proxy unreachable"),
		);
		const fullSet = makeFullToolSet();

		const result = await narrowToolsForMessage("is sonarr up?", fullSet);

		expect(result).toBe(fullSet);
		spy.mockRestore();
	});
});
