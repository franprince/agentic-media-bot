/**
 * A conversation that has gone quiet should not leak into a new request: the
 * model would treat a title from days ago as the one being discussed.
 */
export const SESSION_GAP_MS = 12 * 60 * 60 * 1000;

/**
 * True when the conversation was last active more than SESSION_GAP_MS ago.
 * `lastActiveAt` is null for a conversation saved before activity was
 * recorded, which counts as expired.
 */
export function isSessionExpired(
	lastActiveAt: number | null,
	now: number,
): boolean {
	if (lastActiveAt === null) return true;
	return now - lastActiveAt > SESSION_GAP_MS;
}
