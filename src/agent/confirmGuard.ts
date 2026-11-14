import type { CoreMessage } from "ai";

/**
 * Enforces the two-step add/remove flow in code.
 *
 * The add/remove tools show the match and its settings first and only act when
 * called again with `confirm: true`. Whether the user has actually seen that
 * confirmation is left to the model, and some models skip it. This guard
 * honours `confirm: true` only if an earlier turn of the conversation asked for
 * confirmation of the same item; otherwise the flag is dropped, so the tool
 * returns its confirmation request as usual.
 */

/** Guarded tools and the argument that identifies their target. */
const ID_ARGUMENT: Record<string, string> = {
	addMovie: "tmdbId",
	addSeries: "tvdbId",
	removeMovie: "tmdbId",
	removeSeries: "tvdbId",
};

const TURNS_TO_LOOK_BACK = 3;

function asksForConfirmation(result: any): boolean {
	return Boolean(result?.confirmationRequired || result?.requiresConfirmation);
}

/**
 * True if, in the last few turns before the current message, `toolName`
 * answered with a confirmation request for the same item.
 * `priorHistory` must not include the message being answered.
 */
export function confirmationWasRequested(
	toolName: string,
	args: any,
	priorHistory: CoreMessage[],
): boolean {
	const idArgument = ID_ARGUMENT[toolName];
	if (!idArgument) return true;

	const callArgs = new Map<string, any>();
	for (const message of priorHistory) {
		if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
		for (const part of message.content as any[]) {
			if (part?.type === "tool-call") callArgs.set(part.toolCallId, part.args);
		}
	}

	let turnsSeen = 0;
	for (let i = priorHistory.length - 1; i >= 0; i--) {
		const message = priorHistory[i];
		if (!message) continue;
		if (message.role === "user") {
			turnsSeen++;
			if (turnsSeen >= TURNS_TO_LOOK_BACK) break;
			continue;
		}
		if (message.role !== "tool" || !Array.isArray(message.content)) continue;
		for (const part of message.content as any[]) {
			if (part?.type !== "tool-result" || part.toolName !== toolName) continue;
			if (!asksForConfirmation(part.result)) continue;
			const requestedId = callArgs.get(part.toolCallId)?.[idArgument];
			if (requestedId === undefined || String(requestedId) === String(args?.[idArgument])) {
				return true;
			}
		}
	}
	return false;
}

/** Wraps the add/remove tools so an unrequested `confirm: true` is dropped. */
export function guardConfirmations<T extends Record<string, any>>(
	tools: T,
	priorHistory: CoreMessage[],
): T {
	const guarded: Record<string, any> = { ...tools };
	for (const toolName of Object.keys(ID_ARGUMENT)) {
		const tool = guarded[toolName];
		if (!tool?.execute) continue;
		guarded[toolName] = {
			...tool,
			execute: async (args: any, options: any) => {
				if (
					args?.confirm === true &&
					!confirmationWasRequested(toolName, args, priorHistory)
				) {
					console.warn(
						`🛡️ ${toolName}: confirm=true without a prior confirmation request — asking the user first.`,
					);
					return tool.execute({ ...args, confirm: false }, options);
				}
				return tool.execute(args, options);
			},
		};
	}
	return guarded as T;
}
