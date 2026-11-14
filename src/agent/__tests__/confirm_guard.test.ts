import { describe, expect, it, mock } from "bun:test";
import type { CoreMessage } from "ai";
import { confirmationWasRequested, guardConfirmations } from "../confirmGuard";

function confirmationTurn(toolName: string, args: any, result: any): CoreMessage[] {
	return [
		{ role: "user", content: "add it" },
		{ role: "assistant", content: [{ type: "tool-call", toolCallId: "c1", toolName, args }] },
		{ role: "tool", content: [{ type: "tool-result", toolCallId: "c1", toolName, result }] },
		{ role: "assistant", content: [{ type: "text", text: "Do you agree with this configuration?" }] },
	] as CoreMessage[];
}

const asked = confirmationTurn("addMovie", { tmdbId: 10, title: "Dune" }, { confirmationRequired: true });

describe("confirmationWasRequested", () => {
	it("is true after the tool asked to confirm the same item", () => {
		expect(confirmationWasRequested("addMovie", { tmdbId: 10 }, asked)).toBe(true);
	});

	it("is false for a different item, a different tool or no history", () => {
		expect(confirmationWasRequested("addMovie", { tmdbId: 11 }, asked)).toBe(false);
		expect(confirmationWasRequested("removeMovie", { tmdbId: 10 }, asked)).toBe(false);
		expect(confirmationWasRequested("addMovie", { tmdbId: 10 }, [])).toBe(false);
	});

	it("is false when the earlier call simply succeeded", () => {
		const added = confirmationTurn("addMovie", { tmdbId: 10 }, { success: true });
		expect(confirmationWasRequested("addMovie", { tmdbId: 10 }, added)).toBe(false);
	});

	it("recognises the remove tools' requiresConfirmation", () => {
		const removal = confirmationTurn("removeSeries", { tvdbId: 7 }, { requiresConfirmation: true });
		expect(confirmationWasRequested("removeSeries", { tvdbId: 7, deleteFiles: true }, removal)).toBe(true);
	});

	it("ignores confirmation requests that are several turns old", () => {
		const filler = [
			{ role: "user", content: "a" }, { role: "assistant", content: [{ type: "text", text: "b" }] },
			{ role: "user", content: "c" }, { role: "assistant", content: [{ type: "text", text: "d" }] },
			{ role: "user", content: "e" }, { role: "assistant", content: [{ type: "text", text: "f" }] },
		] as CoreMessage[];
		expect(confirmationWasRequested("addMovie", { tmdbId: 10 }, [...asked, ...filler])).toBe(false);
	});
});

describe("guardConfirmations", () => {
	it("drops confirm: true when the user was never asked", async () => {
		const execute = mock(async (args: any) => args);
		const tools = guardConfirmations({ addMovie: { description: "add", execute } }, []);

		await tools.addMovie.execute({ tmdbId: 10, confirm: true }, {});

		expect(execute.mock.calls[0]?.[0]).toEqual({ tmdbId: 10, confirm: false });
	});

	it("passes confirm: true through after a confirmation request", async () => {
		const execute = mock(async (args: any) => args);
		const tools = guardConfirmations({ addMovie: { description: "add", execute } }, asked);

		await tools.addMovie.execute({ tmdbId: 10, confirm: true }, {});

		expect(execute.mock.calls[0]?.[0]).toEqual({ tmdbId: 10, confirm: true });
	});

	it("leaves unconfirmed calls and other tools untouched", async () => {
		const execute = mock(async (args: any) => args);
		const search = { description: "search", execute };
		const tools = guardConfirmations({ addMovie: { description: "add", execute }, searchMovie: search }, []);

		await tools.addMovie.execute({ tmdbId: 10 }, {});

		expect(execute.mock.calls[0]?.[0]).toEqual({ tmdbId: 10 });
		expect(tools.searchMovie).toBe(search);
	});
});
