import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as proxyClient from "../../agent/proxyClient";
import * as ollamaClassifier from "../ollamaClassifier";
import * as mediaToolsClient from "../media-tools-client";

const originalEnv = { ...process.env };

describe("media-tools-client (USE_PROXY=true)", () => {
	beforeEach(() => {
		process.env.USE_PROXY = "true";
		process.env.PROXY_URL = "http://proxy.local:3001";
		process.env.PROXY_SECRET_KEY = "secret";
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("checkServiceHealth forwards to the mediaTools proxy service", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue({ online: true });

		const result = await mediaToolsClient.checkServiceHealth("Radarr");

		expect(spy).toHaveBeenCalledWith("mediaTools", "checkServiceHealth", ["Radarr"]);
		expect(result).toEqual({ online: true });
		spy.mockRestore();
	});

	it("getDiskSpace forwards to the mediaTools proxy service", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue([]);

		await mediaToolsClient.getDiskSpace();

		expect(spy).toHaveBeenCalledWith("mediaTools", "getDiskSpace", []);
		spy.mockRestore();
	});

	it("getTorrents forwards the filter argument", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue([]);

		await mediaToolsClient.getTorrents("downloading");

		expect(spy).toHaveBeenCalledWith("mediaTools", "getTorrents", ["downloading"]);
		spy.mockRestore();
	});

	it("pauseTorrent forwards the hash argument", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue(undefined);

		await mediaToolsClient.pauseTorrent("deadbeef");

		expect(spy).toHaveBeenCalledWith("mediaTools", "pauseTorrent", ["deadbeef"]);
		spy.mockRestore();
	});

	it("resumeTorrent forwards the hash argument", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue(undefined);

		await mediaToolsClient.resumeTorrent("deadbeef");

		expect(spy).toHaveBeenCalledWith("mediaTools", "resumeTorrent", ["deadbeef"]);
		spy.mockRestore();
	});

	it("pauseAllTorrents forwards no arguments", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue(undefined);

		await mediaToolsClient.pauseAllTorrents();

		expect(spy).toHaveBeenCalledWith("mediaTools", "pauseAllTorrents", []);
		spy.mockRestore();
	});

	it("resumeAllTorrents forwards no arguments", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue(undefined);

		await mediaToolsClient.resumeAllTorrents();

		expect(spy).toHaveBeenCalledWith("mediaTools", "resumeAllTorrents", []);
		spy.mockRestore();
	});

	it("getNZBGetQueue forwards no arguments", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue({ queue: [], status: {} });

		await mediaToolsClient.getNZBGetQueue();

		expect(spy).toHaveBeenCalledWith("mediaTools", "getNZBGetQueue", []);
		spy.mockRestore();
	});

	it("classifyIntent forwards the message argument", async () => {
		const spy = spyOn(proxyClient, "executeOnProxy").mockResolvedValue({
			domain: null,
			confidence: 0,
		});

		await mediaToolsClient.classifyIntent("is sonarr up?");

		expect(spy).toHaveBeenCalledWith("mediaTools", "classifyIntent", ["is sonarr up?"]);
		spy.mockRestore();
	});
});

describe("media-tools-client (local dev, USE_PROXY unset)", () => {
	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("classifyIntent delegates to the local ollamaClassifier", async () => {
		delete process.env.USE_PROXY;
		const spy = spyOn(ollamaClassifier, "classifyIntent").mockResolvedValue({
			domain: "service-health",
			confidence: 0.9,
		});

		const result = await mediaToolsClient.classifyIntent("is sonarr up?");

		expect(spy).toHaveBeenCalledWith("is sonarr up?");
		expect(result).toEqual({ domain: "service-health", confidence: 0.9 });
		spy.mockRestore();
	});
});
