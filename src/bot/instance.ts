import { randomUUID } from "node:crypto";
import { type Bot, GrammyError } from "grammy";
import {
	deleteMetadata,
	getMetadata,
	setMetadata,
} from "../services/database.ts";

export const INSTANCE_ID = randomUUID();

/**
 * Atomic instance check using database metadata.
 * Returns true if this instance should become the leader.
 */
export function acquireInstanceLock(): boolean {
	const activePid = getMetadata("active_instance_pid");
	const activeId = getMetadata("active_instance_id");
	const now = Date.now();
	const heartbeat = Number(getMetadata("instance_heartbeat") || 0);

	// If no active PID, we can take over.
	if (!activePid || !activeId) {
		setMetadata("active_instance_id", INSTANCE_ID);
		setMetadata("active_instance_pid", String(process.pid));
		setMetadata("instance_heartbeat", String(now));
		return true;
	}

	const pid = Number(activePid);
	let running = false;
	try {
		// process.kill(pid, 0) checks if the process exists without killing it
		running = process.kill(pid, 0);
	} catch (e) {
		running = false;
	}

	// If it's already us (same random ID), just update heartbeat and return true
	if (activeId === INSTANCE_ID) {
		setMetadata("instance_heartbeat", String(now));
		return true;
	}

	// Check if the heartbeat is stale (allow 30 seconds) or in the future
	const isHeartbeatStale = now - heartbeat > 30000;
	const isHeartbeatInFuture = heartbeat - now > 300000;

	// If the PID in the database matches our current PID, it means the previous
	// instance used this same PID slot (common in containers where the bot is PID 1).
	// If it's a different random ID, we are in a different container/process namespace,
	// so we must ONLY override if the heartbeat is stale.
	if (pid === process.pid && activeId !== INSTANCE_ID) {
		if (isHeartbeatStale || isHeartbeatInFuture) {
			console.warn(
				`⚠️ [${INSTANCE_ID}] Previous instance used the same PID (${pid}) but its heartbeat is stale. Taking over lock.`,
			);
			setMetadata("active_instance_id", INSTANCE_ID);
			setMetadata("instance_heartbeat", String(now));
			return true;
		}
		return false;
	}

	// If the process is not running at all, we can safely take over
	if (!running) {
		console.log(
			`⚠️ [${INSTANCE_ID}] Previous instance (PID ${pid}) is no longer running. Taking over lock.`,
		);
		setMetadata("active_instance_id", INSTANCE_ID);
		setMetadata("active_instance_pid", String(process.pid));
		setMetadata("instance_heartbeat", String(now));
		return true;
	}

	if (isHeartbeatStale || isHeartbeatInFuture) {
		console.warn(
			`⚠️ [${INSTANCE_ID}] Instance PID ${pid} is running but heartbeat is ${isHeartbeatInFuture ? "in the future" : "stale"}. Overriding lock.`,
		);
		setMetadata("active_instance_id", INSTANCE_ID);
		setMetadata("active_instance_pid", String(process.pid));
		setMetadata("instance_heartbeat", String(now));
		return true;
	}

	return false;
}

/**
 * Handle global 409 conflict errors specifically.
 */
export function setupConflictHandling(bot: Bot<any, any>) {
	bot.catch(async (err) => {
		const error = err.error;
		const msg = err.message;
		if (
			(error instanceof GrammyError && error.error_code === 409) ||
			(msg && msg.includes("409"))
		) {
			const activeId = getMetadata("active_instance_id");
			if (activeId !== INSTANCE_ID) {
				console.error(
					`⛔ [409 Conflict] Another bot instance is polling and we do not own the lock (current ID ${INSTANCE_ID} !== lock owner ${activeId}). Exiting to resolve the conflict.`,
				);
				process.exit(1);
			}
			console.warn(
				`⚠️ [409 Conflict] Grammy reported conflict, but we (${INSTANCE_ID}) own the database lock. Retrying polling...`,
			);
			return;
		}
		console.error("Error in bot:", err);
	});
}

export function startHeartbeat() {
	setInterval(() => {
		const currentActiveId = getMetadata("active_instance_id");

		if (currentActiveId && currentActiveId !== INSTANCE_ID) {
			console.error(
				`\n🛑 [${INSTANCE_ID}] Detected takeover by new instance (${currentActiveId}). Shutting down gracefully.`,
			);
			process.exit(0);
		}

		setMetadata("instance_heartbeat", String(Date.now()));
	}, 10000); // Every 10 seconds
}

// Graceful shutdown handlers
export function setupSignalHandlers() {
	const shutdown = () => {
		console.log(
			`\n🛑 [${INSTANCE_ID}] Received shutdown signal. Cleaning up...`,
		);
		const currentActiveId = getMetadata("active_instance_id");
		if (currentActiveId === INSTANCE_ID) {
			deleteMetadata("active_instance_id");
			deleteMetadata("active_instance_pid");
			deleteMetadata("instance_heartbeat");
			console.log("✅ Instance lock cleared.");
		}
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}
