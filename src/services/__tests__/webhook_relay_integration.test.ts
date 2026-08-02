import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "path";

/**
 * Integration coverage for who writes `media_events` on the relay path.
 *
 * These tests drive the *real* `src/proxy.ts` in a subprocess rather than
 * re-implementing the relay branch in the test, so they actually exercise the
 * shipped code. The proxy can't be imported directly: it calls `process.exit(1)`
 * when PROXY_SECRET_KEY is unset and then binds a port.
 */

const db = new Database(join("data", "bot_data.sqlite"));

function rowsForTitle(title: string): number {
	const row = db
		.query("SELECT COUNT(*) AS n FROM media_events WHERE title = ?")
		.get(title) as { n: number };
	return row.n;
}

function cleanupTitle(title: string) {
	db.run("DELETE FROM media_events WHERE title = ?", [title]);
}

/** Picks a port that is currently free. */
async function freePort(): Promise<number> {
	const s = Bun.serve({ port: 0, fetch: () => new Response("ok") });
	const port = s.port;
	s.stop(true);
	return port;
}

async function startProxy(brainUrl: string) {
	const port = await freePort();
	const proc = Bun.spawn(["bun", "run", "src/proxy.ts"], {
		cwd: process.cwd(),
		env: {
			...process.env,
			PROXY_PORT: String(port),
			PROXY_SECRET_KEY: "test-secret",
			BRAIN_WEBHOOK_URL: brainUrl,
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	// Wait for the port to accept connections.
	for (let i = 0; i < 100; i++) {
		try {
			await fetch(`http://127.0.0.1:${port}/health`);
			return { proc, port };
		} catch {
			await Bun.sleep(100);
		}
	}
	proc.kill();
	throw new Error("proxy did not start in time");
}

async function postNzbget(port: number, title: string) {
	return fetch(`http://127.0.0.1:${port}/nzbget-webhook`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ event: "added", title }),
	});
}

describe("proxy relay — media_events write ownership", () => {
	let title = "";
	const started: { proc: Bun.Subprocess }[] = [];

	afterEach(() => {
		for (const s of started) s.proc.kill();
		started.length = 0;
		if (title) cleanupTitle(title);
	});

	test("does NOT write when the relay to the bot succeeds", async () => {
		title = `Relay.Success.${Date.now()}`;

		// Stand-in for the bot: accepts the relayed webhook.
		const brainPort = await freePort();
		const brain = Bun.serve({
			port: brainPort,
			fetch: () => new Response("OK", { status: 200 }),
		});

		try {
			const { proc, port } = await startProxy(`http://127.0.0.1:${brainPort}`);
			started.push({ proc });

			const res = await postNzbget(port, title);
			expect(res.status).toBe(200);

			await Bun.sleep(300);

			// The bot received it and owns the write. A proxy row here would make
			// the bot's own dbSave() return false and kill the notification.
			expect(rowsForTitle(title)).toBe(0);
		} finally {
			brain.stop(true);
		}
	}, 20000);

	test("DOES write when the relay to the bot fails", async () => {
		title = `Relay.Failure.${Date.now()}`;

		// Point at a port with nothing listening so fetch throws.
		const deadPort = await freePort();
		const { proc, port } = await startProxy(`http://127.0.0.1:${deadPort}`);
		started.push({ proc });

		const res = await postNzbget(port, title);
		expect(res.status).toBe(200);

		await Bun.sleep(300);

		// Nobody else recorded it, so the proxy preserves the history itself.
		expect(rowsForTitle(title)).toBe(1);
	}, 20000);
});
