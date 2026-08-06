import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as mediaToolsClient from "../../services/media-tools-client";
import { pauseAllTorrentsTool, resumeAllTorrentsTool } from "../tools";

type ToolResult = { message: string };

describe("Bulk torrent tools — pauseAllTorrentsTool / resumeAllTorrentsTool", () => {
	let spy: ReturnType<typeof spyOn> | undefined;

	afterEach(() => {
		spy?.mockRestore();
		spy = undefined;
	});

	test("pauseAllTorrentsTool should call mediaToolsClient.pauseAllTorrents and return success message", async () => {
		spy = spyOn(mediaToolsClient, "pauseAllTorrents").mockImplementation(
			async () => undefined,
		);

		const result = (await pauseAllTorrentsTool.execute?.(
			{},
			{} as never,
		)) as ToolResult;

		expect(spy).toHaveBeenCalledTimes(1);
		expect(result.message).toContain("paused");
	});

	test("resumeAllTorrentsTool should call mediaToolsClient.resumeAllTorrents and return success message", async () => {
		spy = spyOn(mediaToolsClient, "resumeAllTorrents").mockImplementation(
			async () => undefined,
		);

		const result = (await resumeAllTorrentsTool.execute?.(
			{},
			{} as never,
		)) as ToolResult;

		expect(spy).toHaveBeenCalledTimes(1);
		expect(result.message).toContain("resumed");
	});

	test("pauseAllTorrentsTool should return error message when qBittorrent throws", async () => {
		spy = spyOn(mediaToolsClient, "pauseAllTorrents").mockImplementation(async () => {
			throw new Error("Connection refused");
		});

		const result = (await pauseAllTorrentsTool.execute?.(
			{},
			{} as never,
		)) as ToolResult;

		expect(result.message).toContain("Failed to pause all torrents");
		expect(result.message).toContain("Connection refused");
	});

	test("resumeAllTorrentsTool should return error message when qBittorrent throws", async () => {
		spy = spyOn(mediaToolsClient, "resumeAllTorrents").mockImplementation(async () => {
			throw new Error("Session expired");
		});

		const result = (await resumeAllTorrentsTool.execute?.(
			{},
			{} as never,
		)) as ToolResult;

		expect(result.message).toContain("Failed to resume all torrents");
		expect(result.message).toContain("Session expired");
	});
});
