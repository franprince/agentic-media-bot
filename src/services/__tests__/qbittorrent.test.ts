import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "bun:test";
import { server } from "../../mocks/server";
import * as qbittorrent from "../qbittorrent";

beforeAll(() => {
	process.env.QBITTORRENT_URL = "http://localhost:8080";
	process.env.QBITTORRENT_USERNAME = "admin";
	process.env.QBITTORRENT_PASSWORD = "adminadmin";
	server.listen();
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});

describe("qBittorrent Service", () => {
	test("getTorrents should authenticate and fetch torrents", async () => {
		const result = await qbittorrent.getTorrents();

		expect(result).toBeArray();
		expect(result[0]?.name).toBe("Ubuntu Linux");
	});
});
