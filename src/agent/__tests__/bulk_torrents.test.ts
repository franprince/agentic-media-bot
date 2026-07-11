import { describe, expect, spyOn, test } from "bun:test";
import * as qbittorrent from "../../services/qbittorrent";
import { pauseAllTorrentsTool, resumeAllTorrentsTool } from "../tools";

type ToolResult = { message: string };

describe("Bulk torrent tools — pauseAllTorrentsTool / resumeAllTorrentsTool", () => {
	test("pauseAllTorrentsTool should call qbittorrent.pauseAllTorrents and return success message", async () => {
		const spy = spyOn(qbittorrent, "pauseAllTorrents").mockImplementation(
			async () => undefined,
		);

		const result = (await pauseAllTorrentsTool.execute?.(
			{},
			{} as never,
		)) as ToolResult;

		expect(spy).toHaveBeenCalledTimes(1);
		expect(result.message).toContain("paused");
	});

	test("resumeAllTorrentsTool should call qbittorrent.resumeAllTorrents and return success message", async () => {
		const spy = spyOn(qbittorrent, "resumeAllTorrents").mockImplementation(
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
		spyOn(qbittorrent, "pauseAllTorrents").mockImplementation(async () => {
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
		spyOn(qbittorrent, "resumeAllTorrents").mockImplementation(async () => {
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
