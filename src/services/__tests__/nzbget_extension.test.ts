import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Tests the real NZBGet extension script by executing it, rather than by
 * re-implementing its logic. Each case runs `main.sh` as a subprocess with the
 * environment NZBGet would set, pointed at a stub server on an ephemeral port.
 */

const EXT_DIR = join("extensions", "nzbget", "AgenticMediaBot");
const SCRIPT = join(EXT_DIR, "main.sh");

/** NZBGet post-processing exit codes. */
const POSTPROCESS_SUCCESS = 93;
const POSTPROCESS_SKIP = 95;

const hasBashAndCurl =
	Bun.which("bash") !== null && Bun.which("curl") !== null;

interface Captured {
	body: string;
	contentType: string | null;
}

/** Runs the script against a stub endpoint, returning its exit code and any request. */
async function runScript(
	env: Record<string, string>,
	opts: { deadEndpoint?: boolean } = {},
): Promise<{ exitCode: number; requests: Captured[]; stdout: string }> {
	const requests: Captured[] = [];

	const server = Bun.serve({
		port: 0,
		async fetch(req) {
			requests.push({
				body: await req.text(),
				contentType: req.headers.get("content-type"),
			});
			return new Response("OK", { status: 200 });
		},
	});

	const url = `http://127.0.0.1:${server.port}/nzbget-webhook`;
	if (opts.deadEndpoint) server.stop(true);

	try {
		const proc = Bun.spawn(["bash", SCRIPT], {
			env: {
				PATH: process.env.PATH ?? "",
				NZBPO_WEBHOOKURL: url,
				NZBPO_TIMEOUT: "5",
				...env,
			},
			stdout: "pipe",
			stderr: "pipe",
		});

		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		return { exitCode, requests, stdout };
	} finally {
		if (!opts.deadEndpoint) server.stop(true);
	}
}

describe("NZBGet extension — manifest", () => {
	const manifest = JSON.parse(
		readFileSync(join(EXT_DIR, "manifest.json"), "utf8"),
	);

	test("declares the fields NZBGet v23+ requires", () => {
		expect(manifest.kind).toBe("QUEUE/POST-PROCESSING");
		expect(manifest.main).toBe("main.sh");
		expect(manifest.queueEvents).toBe("NZB_ADDED");
		expect(manifest.nzbgetMinVersion).toBe("23.0");
	});

	test("exposes WebhookUrl and Timeout options", () => {
		const names = manifest.options.map((o: { name: string }) => o.name);
		expect(names).toContain("WebhookUrl");
		expect(names).toContain("Timeout");
	});

	test("defaults WebhookUrl to the proxy endpoint", () => {
		const url = manifest.options.find(
			(o: { name: string }) => o.name === "WebhookUrl",
		).value;
		expect(url).toBe("http://localhost:3001/nzbget-webhook");
	});
});

describe.skipIf(!hasBashAndCurl)("NZBGet extension — main.sh", () => {
	test("posts 'added' when an NZB enters the queue", async () => {
		const { requests, exitCode } = await runScript({
			NZBNA_EVENT: "NZB_ADDED",
			NZBNA_NZBNAME: "Some.Movie.2026",
		});

		expect(exitCode).toBe(0);
		expect(requests).toHaveLength(1);
		expect(JSON.parse(requests[0]!.body)).toEqual({
			event: "added",
			title: "Some.Movie.2026",
		});
		expect(requests[0]!.contentType).toContain("application/json");
	});

	test("posts 'success' and exits 93 when a download completes", async () => {
		const { requests, exitCode } = await runScript({
			NZBPP_TOTALSTATUS: "SUCCESS",
			NZBPP_NZBNAME: "Some.Show.S01E01",
		});

		expect(exitCode).toBe(POSTPROCESS_SUCCESS);
		expect(JSON.parse(requests[0]!.body)).toEqual({
			event: "success",
			title: "Some.Show.S01E01",
		});
	});

	test("posts nothing and exits 95 on a failed download", async () => {
		const { requests, exitCode } = await runScript({
			NZBPP_TOTALSTATUS: "FAILURE",
			NZBPP_NZBNAME: "Broken.Release",
		});

		expect(exitCode).toBe(POSTPROCESS_SKIP);
		expect(requests).toHaveLength(0);
	});

	test("posts nothing for queue events other than NZB_ADDED", async () => {
		const { requests, exitCode } = await runScript({
			NZBNA_EVENT: "NZB_DELETED",
			NZBNA_NZBNAME: "Removed.Item",
		});

		expect(exitCode).toBe(0);
		expect(requests).toHaveLength(0);
	});

	test("exits 95 when invoked with no NZBGet variables at all", async () => {
		const { requests, exitCode } = await runScript({});

		expect(exitCode).toBe(POSTPROCESS_SKIP);
		expect(requests).toHaveLength(0);
	});

	test("produces valid JSON for titles with quotes, backslashes and non-ASCII", async () => {
		// This library really does contain titles like キャプテン翼.
		const title = 'Some "Quoted" キャプテン翼 \\ Show';

		const { requests } = await runScript({
			NZBNA_EVENT: "NZB_ADDED",
			NZBNA_NZBNAME: title,
		});

		expect(requests).toHaveLength(1);
		const parsed = JSON.parse(requests[0]!.body); // throws if escaping is wrong
		expect(parsed.title).toBe(title);
		expect(parsed.event).toBe("added");
	});

	test("still exits 93 when the webhook endpoint is unreachable", async () => {
		const { exitCode, stdout } = await runScript(
			{
				NZBPP_TOTALSTATUS: "SUCCESS",
				NZBPP_NZBNAME: "Unreachable.Endpoint",
			},
			{ deadEndpoint: true },
		);

		// A notification problem must never mark a good download as failed.
		expect(exitCode).toBe(POSTPROCESS_SUCCESS);
		expect(stdout).toContain("WARNING");
	});
});
