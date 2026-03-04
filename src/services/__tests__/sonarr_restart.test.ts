import { describe, expect, test, spyOn } from "bun:test";
import * as sonarr from "../sonarr";

describe("Sonarr Restart Logic", () => {
    test("restartSonarrService should call Bun.spawn with correct arguments", async () => {
        // @ts-ignore - Bun.spawn is a global but spyOn needs to know about it
        const spawnSpy = spyOn(Bun, "spawn").mockImplementation(() => ({
            exited: Promise.resolve(0),
        } as any));

        await sonarr.restartSonarrService();

        expect(spawnSpy).toHaveBeenCalledWith(expect.objectContaining({
            cmd: ["systemctl", "restart", "snap.sonarr.sonarr.service"],
        }));

        spawnSpy.mockRestore();
    });
});
