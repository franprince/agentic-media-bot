import { expect, test, describe, spyOn, afterEach } from "bun:test";
import * as sonarr from "../sonarr";
import { removeSeriesTool } from "../../agent/tools";

describe("Sonarr Remove Series", () => {
    const spies: any[] = [];

    afterEach(() => {
        while (spies.length > 0) {
            const s = spies.pop();
            if (s && s.mockRestore) s.mockRestore();
        }
    });

    test("should fail if series is not found by tvdbId", async () => {
        spies.push(spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(async () => undefined));

        const result = await removeSeriesTool.execute({
            tvdbId: 99999,
            deleteFiles: false
        }, {} as any) as any;

        expect(result.message).toContain("Could not find a series");
    });

    test("should call deleteSeries with correct arguments", async () => {
        spies.push(spyOn(sonarr, "getSeriesByTvdbId").mockImplementation(async () => ({
            id: 10,
            title: "Test Series",
            tvdbId: 12345
        } as any)));

        const deleteSpy = spyOn(sonarr, "deleteSeries").mockImplementation(async () => { });
        spies.push(deleteSpy);

        const result = await removeSeriesTool.execute({
            tvdbId: 12345,
            deleteFiles: true
        }, {} as any) as any;

        expect(result.success).toBe(true);
        expect(result.message).toContain("Successfully removed");
        expect(deleteSpy).toHaveBeenCalledWith(10, true);
    });
});
