import { describe, expect, mock, spyOn, test } from "bun:test";
import * as qbittorrent from "../../services/qbittorrent";
import { pauseAllTorrentsTool, resumeAllTorrentsTool } from "../tools";

describe("Bulk torrent tools — pauseAllTorrentsTool / resumeAllTorrentsTool", () => {
	test("pauseAllTorrentsTool should call qbittorrent.pauseAllTorrents and return success message", async () => {
		const spy = spyOn(qbittorrent, "pauseAllTorrents").mockImplementation(
			async () => undefined,
		);

		const result = await pauseAllTorrentsTool.execute!({} as any, {} as any);

		expect(spy).toHaveBeenCalledTimes(1);
		expect((result as any).message).toContain("paused");
	});

	test("resumeAllTorrentsTool should call qbittorrent.resumeAllTorrents and return success message", async () => {
		const spy = spyOn(qbittorrent, "resumeAllTorrents").mockImplementation(
			async () => undefined,
		);

		const result = await resumeAllTorrentsTool.execute!({} as any, {} as any);

		expect(spy).toHaveBeenCalledTimes(1);
		expect((result as any).message).toContain("resumed");
	});

	test("pauseAllTorrentsTool should return error message when qBittorrent throws", async () => {
		spyOn(qbittorrent, "pauseAllTorrents").mockImplementation(async () => {
			throw new Error("Connection refused");
		});

		const result = await pauseAllTorrentsTool.execute!({} as any, {} as any);

		expect((result as any).message).toContain("Failed to pause all torrents");
		expect((result as any).message).toContain("Connection refused");
	});

	test("resumeAllTorrentsTool should return error message when qBittorrent throws", async () => {
		spyOn(qbittorrent, "resumeAllTorrents").mockImplementation(async () => {
			throw new Error("Session expired");
		});

		const result = await resumeAllTorrentsTool.execute!({} as any, {} as any);

		expect((result as any).message).toContain("Failed to resume all torrents");
		expect((result as any).message).toContain("Session expired");
	});
});
