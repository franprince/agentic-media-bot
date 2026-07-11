/**
 * Webhook Event Queue
 *
 * Serializes all notification delivery through a single async worker.
 * Provides two complementary deduplication layers:
 *
 *  Layer 1 — In-memory (fast path):
 *    If an identical event (service + event_type + title) is already in the queue
 *    waiting to be processed, subsequent arrivals are dropped immediately.
 *    This handles rapid-fire duplicates (e.g. 3 Sonarr webhook connections firing
 *    simultaneously).
 *
 *  Layer 2 — Database (safety net):
 *    The `dbSave` closure calls saveMediaEvent(), which uses a BEGIN IMMEDIATE
 *    transaction to atomically check + insert within a 60-second dedup window.
 *    This catches duplicates that arrive *after* the in-memory key has been cleared
 *    (e.g. the same episode re-downloaded 30 seconds later).
 */

export interface QueuedEvent {
	/**
	 * Dedup key — must be unique per logical event.
	 * Convention: `"service:eventType:title"` (all lowercase).
	 */
	key: string;

	/** Human-readable label used in log output. */
	label: string;

	/**
	 * Called synchronously by the queue worker to persist the event.
	 * Returns `true`  → event is new, proceed with notification.
	 * Returns `false` → duplicate within the DB dedup window, skip notification.
	 */
	dbSave: () => boolean;

	/**
	 * Called asynchronously by the queue worker to deliver the Telegram notification.
	 * Only invoked when `dbSave()` returns `true`.
	 */
	send: () => Promise<void>;
}

class EventQueue {
	private queue: QueuedEvent[] = [];

	/**
	 * Tracks events currently in the queue by their key.
	 * Cleared as each event finishes processing (after send completes or errors).
	 */
	private pendingKeys = new Set<string>();

	/** True while the drain loop is running. Prevents concurrent drain calls. */
	private processing = false;

	/**
	 * Add an event to the queue.
	 * Returns `true` if the event was accepted, `false` if it was dropped as a
	 * duplicate of an event already pending in the queue.
	 */
	enqueue(event: QueuedEvent): boolean {
		if (this.pendingKeys.has(event.key)) {
			console.log(`🔁 EventQueue: Dropped in-queue duplicate [${event.label}]`);
			return false;
		}

		this.pendingKeys.add(event.key);
		this.queue.push(event);

		// Kick off the drain loop without blocking the caller.
		// Using void to intentionally discard the promise (fire-and-forget).
		void this.drain();
		return true;
	}

	/** Number of events currently waiting to be processed. */
	get size(): number {
		return this.queue.length;
	}

	/** Keys of events currently pending in the queue (for testing). */
	get pendingKeySet(): ReadonlySet<string> {
		return this.pendingKeys;
	}

	/**
	 * Drains the queue serially.
	 * Re-entrant: if already processing, the current loop picks up any newly
	 * added items via the `while` condition — no second drain is started.
	 */
	private async drain(): Promise<void> {
		if (this.processing) return;
		this.processing = true;

		while (this.queue.length > 0) {
			const event = this.queue.shift()!;
			try {
				const isNew = event.dbSave();
				if (isNew) {
					await event.send();
				} else {
					console.log(`🔁 EventQueue: DB dedup dropped [${event.label}]`);
				}
			} catch (err) {
				console.error(
					`EventQueue: Error processing [${event.label}]:`,
					(err as Error).message,
				);
			} finally {
				// Release the in-memory dedup key so future events with the same key
				// are not permanently blocked (they will still be checked by saveMediaEvent).
				this.pendingKeys.delete(event.key);
			}
		}

		this.processing = false;
	}
}

/**
 * Singleton queue instance shared across all webhook handlers.
 * Import and use `webhookEventQueue.enqueue(event)` from webhook handlers.
 */
export const webhookEventQueue = new EventQueue();
