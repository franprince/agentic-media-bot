import { type CoreMessage, generateText } from "ai";
import {
	clearHistory,
	getConversationUpdatedAt,
	getHistory,
	getUserName,
	saveHistory,
	setUserName,
	trimHistory,
} from "../services/database.ts";
import { normalizeCountryName } from "../services/plex";
import {
	extractNameFromText,
	hasNameIntent,
	shouldDisableAddActions,
} from "./intent";
import { guardConfirmations } from "./confirmGuard";
import {
	CLAUDE_HISTORY_CHAR_BUDGET,
	DEFAULT_HISTORY_CHAR_BUDGET,
	prepareHistoryForModel,
} from "./historyBudget";
import {
	buildSystemPromptTemplate,
	fillSystemPrompt,
	NEED_MORE_TOOLS_MARKER,
} from "./prompts";
import {
	getCapableModel,
	getCapableModelName,
	getFastModel,
	getFastModelName,
	isAnthropicProvider,
} from "./provider";
import { executeOnProxy, isProxyEnabled } from "./proxyClient";
import { isSessionExpired } from "./session";
import {
	buildExactCountPrefix,
	buildPlexBrowseAuthoritativeText,
	extractToolResultsFromMessages,
	noToolReply,
	scrubMarker,
	scrubMarkerFromMessages,
	selectReplyButtons,
} from "./response";
import {
	detectConversationLanguage,
	detectStatusLanguage,
	formatToolCallsStatus,
	type StatusLanguage,
} from "./status";
import {
	ALL_GROUPS,
	classifyGroups,
	pickToolsForGroups,
	type RoutingDecision,
	selectToolGroups,
	type ToolGroup,
} from "./toolRouter";
import * as botTools from "./tools";
import {
	buildLanguageRewritePrompt,
	buildToolArgsRepairPrompt,
	convertMarkdownTablesToLists,
	getLastUserTextFromHistory,
	isInvalidToolArgumentsError,
	normalizeToolCallsForLogging,
	shouldRewriteForTargetLanguage,
} from "./utils";

/**
 * Process a user message using the AI agent.
 * `options.fromButton` marks a button tap: it answers a specific earlier
 * message, so it always continues the stored conversation.
 */
export async function processUserMessage(
	userId: number,
	userMessage?: string,
	onStep?: (status: string) => Promise<void>,
	options: { fromButton?: boolean } = {},
): Promise<{
	text: string;
	imageUrl?: string;
	buttons?: Array<{ text: string; data: string }>;
}> {
	// Retrieve conversation history for the user from SQLite
	let history = getHistory(userId);
	const userName = getUserName(userId) || "Friend";

	// --- Legacy Tool Rename Migration ---
	// We recently renamed tools (searchPlexLibrary -> searchPlexByTitleOnly, browsePlexByCountry -> findPlexByCountry)
	// To avoid confusing the model with old tool names in history, we migrate them on the fly.
	history = history.map((msg) => {
		if (msg.role === "assistant" && Array.isArray(msg.content)) {
			msg.content = msg.content.map((part) => {
				if (part.type === "tool-call") {
					if (part.toolName === "searchPlexLibrary")
						part.toolName = "searchPlexByTitleOnly";
					if (
						part.toolName === "browsePlexByCountry" ||
						part.toolName === "findPlexByCountry"
					)
						part.toolName = "searchPlexByCountry";
					if (part.toolName === "browsePlexByGenre")
						part.toolName = "searchPlexByGenre";
				}
				return part;
			});
		}
		if (msg.role === "tool" && Array.isArray(msg.content)) {
			msg.content = msg.content.map((part) => {
				if (part.type === "tool-result") {
					if (part.toolName === "searchPlexLibrary")
						part.toolName = "searchPlexByTitleOnly";
					if (
						part.toolName === "browsePlexByCountry" ||
						part.toolName === "findPlexByCountry"
					)
						part.toolName = "searchPlexByCountry";
					if (part.toolName === "browsePlexByGenre")
						part.toolName = "searchPlexByGenre";
				}
				return part;
			});
		}
		return msg;
	}) as CoreMessage[];

	// Check for name intent and save user name if provided
	if (userMessage && hasNameIntent(userMessage)) {
		const name = extractNameFromText(userMessage);
		if (name) {
			setUserName(userId, name);
		}
	}

	// What the user wrote before this message, read before a reset can clear
	// it: a message that shows no language keeps the conversation's.
	const recentUserTexts = history
		.filter((m) => m.role === "user" && typeof m.content === "string")
		.slice(-4)
		.map((m) => m.content as string);

	// Add the user's message to the history ONLY if it's a new message
	if (userMessage) {
		// On Claude a typed message after a long silence starts a new
		// conversation, so a stale turn is not read as the current topic. The
		// activity time is read before the trim, which can save the row.
		const startsNewConversation =
			isAnthropicProvider() &&
			!options.fromButton &&
			history.length > 0 &&
			isSessionExpired(getConversationUpdatedAt(userId), Date.now());
		if (startsNewConversation) {
			clearHistory(userId);
			history = [];
			console.log(
				"🧹 Conversation idle for more than 12 hours: starting a new one.",
			);
		} else {
			history = trimHistory(userId, 20);
		}

		history.push({ role: "user", content: userMessage });
		saveHistory(userId, history);
	}

	try {
		const statusSeedText = userMessage ?? getLastUserTextFromHistory(history);
		const statusLang: StatusLanguage = detectConversationLanguage(
			statusSeedText,
			recentUserTexts,
		);
		const modelFastName = getFastModelName();
		const modelCapableName = getCapableModelName();
		const modelFast = getFastModel();
		const modelCapable = getCapableModel();

		const userName = getUserName(userId) || "Friend";

		// --- Step 1: Tool Execution Loop (using FAST model) ---
		const shouldDisableAddTools = shouldDisableAddActions(statusSeedText);
		const tools: any = {
			searchMovie: botTools.searchMovieTool,
			addMovie: botTools.addMovieTool,
			removeMovie: botTools.removeMovieTool,
			getMovieQueue: botTools.getMovieQueueTool,
			searchSeries: botTools.searchSeriesTool,
			addSeries: botTools.addSeriesTool,
			removeSeries: botTools.removeSeriesTool,
			getSeriesQueue: botTools.getSeriesQueueTool,
			getTorrents: botTools.getTorrentsTool,
			pauseTorrent: botTools.pauseTorrentTool,
			resumeTorrent: botTools.resumeTorrentTool,
			pauseAllTorrents: botTools.pauseAllTorrentsTool,
			resumeAllTorrents: botTools.resumeAllTorrentsTool,
			checkServiceHealth: botTools.checkServiceHealthTool,
			getMissingMovies: botTools.getMissingMoviesTool,
			getMissingSeries: botTools.getMissingSeriesTool,
			getMissingEpisodes: botTools.getMissingEpisodesTool,
			getNZBGetQueue: botTools.getNZBGetQueueTool,
			searchPlexByTitleOnly: botTools.searchPlexByTitleOnlyTool,
			// The legacy names (browsePlexByGenre, findPlexByCountry) are no longer
			// offered as duplicate tools: the history migration above already
			// rewrites them, and each alias cost a full extra schema per request.
			searchPlexByGenre: botTools.browsePlexByGenreTool,
			searchPlexByCountry: botTools.findPlexByCountryTool,
			searchPlexByDuration: botTools.searchPlexByDurationTool,
			getRecentlyAddedPlex: botTools.getRecentlyAddedPlexTool,
			getPlexLibraryStats: botTools.getPlexLibraryStatsTool,
			discoverMedia: botTools.discoverMediaTool,
			getUnwatchedEpisodes: botTools.getUnwatchedEpisodesTool,
			subscribeToDownload: botTools.subscribeToDownloadTool,
			getWatchlist: botTools.getWatchlistTool,
			addToWatchlist: botTools.addToWatchlistTool,
			removeFromWatchlist: botTools.removeFromWatchlistTool,
			syncWatchlist: botTools.syncWatchlistTool,
			getPlexSessions: botTools.getPlexSessionsTool,
			getDiskSpace: botTools.getDiskSpaceTool,
			subscribeToReport: botTools.subscribeToReportTool,
			unsubscribeFromReport: botTools.unsubscribeFromReportTool,
			getReportSubscriptions: botTools.getReportSubscriptionsTool,
			getErsatzTVStatus: botTools.getErsatzTVStatusTool,
			getErsatzTVGuide: botTools.getErsatzTVGuideTool,
			channelDirector: botTools.channelDirectorTool,
		};

		if (shouldDisableAddTools) {
			delete tools.addMovie;
			delete tools.addSeries;
		}

		// --- Step 0: Tool routing (token budget) ---
		// Only the tool groups this message can need are sent, with the matching
		// prompt sections. Never gates execution: with no evidence the full tool
		// set is used, and a narrowed model can ask for more (NEED_MORE_TOOLS).
		// See specs/2026-11-14-token-budget.
		const lastUserIndex = history.map((m) => m.role).lastIndexOf("user");
		const priorHistory =
			lastUserIndex >= 0 ? history.slice(0, lastUserIndex) : history;
		const routedText = statusSeedText ?? "";
		let routing: RoutingDecision = await selectToolGroups(
			routedText,
			priorHistory,
			modelFast,
		);
		const toolsForGroups = (groups: ToolGroup[]) =>
			pickToolsForGroups(tools, groups);
		const narrowedTools = toolsForGroups(routing.groups);
		console.log(
			`🧭 Tool routing [${routing.source}]: ${routing.groups.join(", ") || "none"} → ${Object.keys(narrowedTools).length}/${Object.keys(tools).length} tools`,
		);

		// --- Defensive Tool Filtering ---
		// Ensure no tool is undefined before passing to generateText to prevent crashes in AI SDK.
		const activeToolEntries = Object.entries(narrowedTools).filter(([name, tool]) => {
			if (tool === undefined) {
				console.warn(
					`⚠️ Warning: Tool "${name}" is undefined and will be excluded from this request.`,
				);
				return false;
			}
			return true;
		});
		const sanitizedTools = Object.fromEntries(activeToolEntries);

		// --- Proxy Tool Interception ---
		const withProxyInterception = (toolSet: Record<string, any>) => {
			if (!isProxyEnabled()) return toolSet;
			return Object.fromEntries(
				Object.entries(toolSet).map(([name, toolObject]) => {
					return [
						name,
						{
							...(toolObject as any),
							execute: async (args: any, options: any) => {
								// Maps the unified tool name (e.g. "searchMovie") to the actual exported SDK tool name (e.g. "searchMovieTool")
								// by looking up the key in the original mapping, but wait, the Proxy needs the target function.
								// We can just send the tool object key from `botTools`.
								const originalExportName = Object.keys(botTools).find(
									(k) => (botTools as any)[k] === toolObject,
								);

								if (!originalExportName) {
									throw new Error(
										`Could not find export name for tool ${name}`,
									);
								}

								// Send the RPC payload: { service: "tools", method: "searchMovieTool", args: [args, {}] }
								return await executeOnProxy("tools", originalExportName, [
									args,
									{},
								]);
							},
						},
					];
				}),
			);
		};
		// Add/remove only honour confirm: true after the user was asked.
		const finalTools = guardConfirmations(
			withProxyInterception(sanitizedTools),
			priorHistory,
		);

		const currentDate = new Date().toLocaleDateString("en-US", {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
		});

		const promptContext = {
			userId,
			userName,
			currentDate,
			language: statusLang,
		};
		const systemPromptFor = (groups: ToolGroup[]) =>
			fillSystemPrompt(buildSystemPromptTemplate(groups), promptContext);
		// With every tool schema in the request there is less room for history.
		const historyBudgetFor = (decision: RoutingDecision) =>
			decision.narrowed
				? DEFAULT_HISTORY_CHAR_BUDGET
				: Math.floor(DEFAULT_HISTORY_CHAR_BUDGET / 3);
		// Claude has no tokens-per-minute cap: it gets the recent turns as they
		// happened. The budgeted, compacted view is for the capped providers.
		const sendsFullHistory = isAnthropicProvider();
		const historyViewFor = (decision: RoutingDecision) =>
			sendsFullHistory
				? prepareHistoryForModel(history, CLAUDE_HISTORY_CHAR_BUDGET, {
						compactOlderTurns: false,
					})
				: prepareHistoryForModel(history, historyBudgetFor(decision));
		const withTools = (toolSet: Record<string, any>) =>
			Object.keys(toolSet).length > 0 ? { tools: toolSet } : {};

		const firstPassParams = {
			model: modelFast as any,
			system: systemPromptFor(routing.groups),
			messages: historyViewFor(routing),
			...withTools(finalTools),
			onStepFinish: async (step: any) => {
				const thought = step.text?.trim();
				const normalizedToolCalls = normalizeToolCallsForLogging(
					step.toolCalls as any[],
				);
				if (onStep && (thought || step.toolCalls.length > 0)) {
					console.log(
						`📡 Step Tool Calls[FAST]: `,
						JSON.stringify(normalizedToolCalls, null, 2),
					);

					if (step.toolCalls.length > 0) {
						const statusText = formatToolCallsStatus(
							normalizedToolCalls as any[],
							statusLang,
						);
						await onStep(`🔄 ${statusText} `);
						return;
					}

					// For thought-only steps, avoid sending long final answers as status updates.
					if (
						thought &&
						thought.length <= 140 &&
						!thought.includes("\n") &&
						!thought.includes(NEED_MORE_TOOLS_MARKER)
					) {
						await onStep(`🔄 ${thought} `);
					}
				}
			},
			maxSteps: 5,
		} as const;

		let firstPass: any;
		try {
			firstPass = await generateText(firstPassParams as any);
		} catch (error: any) {
			if (isInvalidToolArgumentsError(error)) {
				if (onStep) {
					const retryStatus =
						statusLang === "es"
							? "Ups—hubo un problema con los datos de una herramienta. Reintentando..."
							: "Oops—there was an issue with tool arguments. Retrying...";
					await onStep(`🔄 ${retryStatus} `);
				}

				const repairPrompt = buildToolArgsRepairPrompt(
					error?.toolName,
					error?.toolArgs,
					statusLang,
				);
				firstPass = await generateText({
					...firstPassParams,
					messages: [
						...firstPassParams.messages,
						{ role: "user", content: repairPrompt },
					],
				} as any);
			} else {
				throw error;
			}
		}

		// --- Safety net: the narrowed tool set was not enough ---
		// The model answers NEED_MORE_TOOLS (see prompts.ts) when the request
		// needs a tool it was not given. Widen once: ask the classifier which
		// groups are missing, or offer everything if it adds nothing new.
		if (
			routing.narrowed &&
			firstPass.toolResults.length === 0 &&
			(firstPass.text || "").includes(NEED_MORE_TOOLS_MARKER)
		) {
			const classified =
				routing.source === "classifier"
					? null
					: await classifyGroups(routedText, modelFast);
			const extra = [...(classified ?? [])].filter(
				(group) => !routing.groups.includes(group),
			);
			routing =
				extra.length > 0
					? {
							groups: [...routing.groups, ...extra],
							source: "classifier",
							narrowed: true,
						}
					: { groups: [...ALL_GROUPS], source: "fallback", narrowed: false };
			const widenedTools = guardConfirmations(
				withProxyInterception(toolsForGroups(routing.groups)),
				priorHistory,
			);
			console.log(
				`🧭 Tool routing widened [${routing.source}]: ${routing.groups.join(", ")} → ${Object.keys(widenedTools).length} tools`,
			);
			const { tools: _narrowTools, ...paramsWithoutTools } =
				firstPassParams as any;
			firstPass = await generateText({
				...paramsWithoutTools,
				system: systemPromptFor(routing.groups),
				messages: historyViewFor(routing),
				...withTools(widenedTools),
			} as any);
		}
		if (firstPass.usage) {
			console.log(
				`📊 Tokens [FAST]: prompt ${firstPass.usage.promptTokens}, completion ${firstPass.usage.completionTokens}`,
			);
		}

		let response = firstPass;

		// --- Step 2: Synthesis (using CAPABLE model if tools were involved) ---
		if (
			firstPass.toolResults.length > 0 &&
			modelFastName !== modelCapableName
		) {
			if (onStep) {
				const synthesisStatus =
					statusLang === "es"
						? "✍️ _Redactando la respuesta final..._"
						: "✍️ _Synthesizing final response..._";
				await onStep(synthesisStatus);
			}

			console.log(
				`🧠 Synthesizing final response with CAPABLE model: ${modelCapableName} `,
			);

			const synthesis = await generateText({
				model: modelCapable as any,
				system: `${systemPromptFor(routing.groups)}\n\nSynthesize the final response. REMEMBER: Never use 'Poster:' text placeholders. If poster URLs are present in the tool results above, include them internally using the POSTER: <url> format at the very end of your message.`,
				messages: [
					...historyViewFor(routing),
					...scrubMarkerFromMessages(firstPass.response.messages, ""),
				],
			});

			response = synthesis;
		}

		// Never show the internal marker to the user, and never save it: the
		// model would read it back as its own answer on the next turn. A reply
		// that was nothing but the marker becomes a plain "not yet" message.
		let replyText: string = response.text || "";
		let noToolFallback = "";
		if (replyText.includes(NEED_MORE_TOOLS_MARKER)) {
			const cleaned = scrubMarker(replyText);
			noToolFallback = cleaned ? "" : noToolReply(statusLang);
			replyText = cleaned || noToolFallback;
		}

		if (response.toolResults.length > 0) {
			console.log(
				`🛠️ Tool Results: `,
				JSON.stringify(
					response.toolResults.map((r: any) => ({
						tool: r.toolName,
						result: r.result,
					})),
					null,
					2,
				),
			);
		}

		// Add the agent's full response (including tool interactions) to the history
		if (response === firstPass) {
			history.push(
				...scrubMarkerFromMessages(firstPass.response.messages, noToolFallback),
			);
		} else {
			// Include everything from first pass PLUS the final synthesis message
			history.push(
				...scrubMarkerFromMessages(firstPass.response.messages, ""),
				...scrubMarkerFromMessages(response.response.messages, noToolFallback),
			);
		}
		saveHistory(userId, history);

		let text = replyText || "I had trouble formulating a response.";
		let imageUrl: string | undefined;
		let buttons: Array<{ text: string; data: string }> | undefined;

		// Scrub any remaining textual placeholders the model might have hallucinated
		text = text.replace(/^(Poster|Image|Thumbnail|Poster URL):\s*.*$/gim, "");
		text = text.replace(/\[\s*(Insert|Poster|Image|Thumbnail).*\]/gi, "");
		text = text.trim();

		const extractedFromFirstPass = extractToolResultsFromMessages(
			firstPass?.response?.messages,
		);
		const extractedFromFinalPass = extractToolResultsFromMessages(
			response?.response?.messages,
		);
		const toolResultsForCounts = [
			...(response.toolResults || []),
			...(firstPass.toolResults || []),
			...extractedFromFinalPass,
			...extractedFromFirstPass,
		];
		const authoritativePlexBrowseText = buildPlexBrowseAuthoritativeText(
			toolResultsForCounts as any[],
			statusLang,
		);
		if (authoritativePlexBrowseText) {
			text = authoritativePlexBrowseText;
		}

		const exactCountPrefix = buildExactCountPrefix(
			toolResultsForCounts as any[],
			statusLang,
		);
		if (exactCountPrefix) {
			const hasExactPrefixAlready = text.startsWith(exactCountPrefix);
			if (!hasExactPrefixAlready) {
				text = `${exactCountPrefix} \n\n${text} `.trim();
			}
		}

		// Extract buttons from tool results if any tool suggested them
		let toolRequiresConfirmation = false;
		for (const tr of toolResultsForCounts) {
			if (
				tr.result &&
				(tr.result.confirmationRequired || tr.result.requiresConfirmation)
			) {
				toolRequiresConfirmation = true;
			}
			if (tr.result && Array.isArray(tr.result.buttons) && !buttons) {
				buttons = tr.result.buttons.map((btn: any) => {
					let btnText = btn.text;
					if (statusLang === "es") {
						// Add buttons may carry the default profile: "✅ Yes, Add Movie (HD-1080p)".
						if (btnText.startsWith("✅ Yes, Add Movie")) btnText = btnText.replace("✅ Yes, Add Movie", "✅ Sí, añadir película");
						else if (btnText.startsWith("✅ Yes, Add Series")) btnText = btnText.replace("✅ Yes, Add Series", "✅ Sí, añadir serie");
						else if (btnText === "❌ Cancel") btnText = "❌ Cancelar";
						else if (btnText === "✅ Remove from Radarr only") btnText = "✅ Solo eliminar de Radarr";
						else if (btnText === "✅ Remove from Sonarr only") btnText = "✅ Solo eliminar de Sonarr";
						else if (btnText === "🗑️ Remove and DELETE files") btnText = "🗑️ Eliminar y borrar archivos";
					}
					return { ...btn, text: btnText };
				});
			}
		}

		// Extract poster URL if present (matching both remote https and local/relative paths)
		const posterMatch = text.match(/POSTER:\s*(\S+)/i);
		if (posterMatch) {
			imageUrl = posterMatch[1];
			text = text.replace(/POSTER:\s*(\S+)/i, "").trim();
		}

		if (!imageUrl) {
			// Fallback: Programmatically search for a poster URL in the tool results
			for (const tr of toolResultsForCounts) {
				if (!tr.result) continue;

				if (tr.result.posterUrl && typeof tr.result.posterUrl === "string") {
					imageUrl = tr.result.posterUrl;
					break;
				}

				const items = Array.isArray(tr.result)
					? tr.result
					: Array.isArray(tr.result.suggestions)
						? tr.result.suggestions
						: [];

				if (items.length > 0) {
					// Count how many items from the tool results are mentioned in the text
					const mentionedItems = items.filter(
						(item: any) =>
							typeof item?.title === "string" &&
							text.toLowerCase().includes(item.title.toLowerCase()),
					);

					// If more than 1 item is mentioned, it's a list. Do not attach a poster via fallback.
					if (mentionedItems.length > 1) {
						continue;
					}

					const matchedItem =
						mentionedItems[0] || (items.length === 1 ? items[0] : null);

					if (
						matchedItem &&
						matchedItem.posterUrl &&
						typeof matchedItem.posterUrl === "string"
					) {
						imageUrl = matchedItem.posterUrl;
						break;
					}
				}
			}
		}

		// Extract interactive buttons if present
		const buttonMatches = text.matchAll(
			/^\*?\*?BUTTON:\s*(.*?)\s*\|\s*(.*?)\s*\*?\*?$/gim,
		);
		const extractedButtons: Array<{ text: string; data: string }> = [];
		for (const match of buttonMatches) {
			if (match[1] && match[2]) {
				const btnText = match[1].trim().replace(/\*?\*?$/, ""); // Clean any trailing bolding
				extractedButtons.push({
					text: btnText,
					data: match[2].trim().replace(/\*?\*?$/, ""),
				});
			}
		}

		// Tool buttons (real IDs, default settings) win over the model's own
		// BUTTON: lines; see selectReplyButtons.
		buttons = selectReplyButtons(buttons, extractedButtons, toolRequiresConfirmation);
		if (extractedButtons.length > 0) {
			// Remove button lines from text
			text = text.replace(/^\*?\*?BUTTON:.*$/gim, "").trim();
		}

		if (text && shouldRewriteForTargetLanguage(text, statusLang)) {
			try {
				const rewritten = await generateText({
					model: modelCapable as any,
					messages: [
						{ role: "system", content: buildLanguageRewritePrompt(statusLang) },
						{ role: "user", content: text },
					],
				});
				const candidate = rewritten.text?.trim();
				if (candidate) text = candidate;
			} catch (rewriteError) {
				console.warn(
					"Language rewrite step failed; returning original text.",
					rewriteError,
				);
			}
		}

		text = convertMarkdownTablesToLists(text);

		console.log(`🤖 Bot Response to ${userId}: `, text);
		if (imageUrl) console.log(`🖼️ Attached Poster: `, imageUrl);
		if (buttons) console.log(`🔘 Attached Buttons: `, JSON.stringify(buttons));

		return { text, imageUrl, buttons };
	} catch (error) {
		console.error("Error processing LLM response:", error);
		const fallbackLang = detectStatusLanguage(
			userMessage ?? getLastUserTextFromHistory(history),
		);
		return {
			text:
				fallbackLang === "es"
					? "Lo siento, tuve un error al procesar tu pedido."
					: "Sorry, I encountered an error while trying to process your request.",
		};
	}
}
