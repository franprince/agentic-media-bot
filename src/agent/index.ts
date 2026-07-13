import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { type CoreMessage, generateText } from "ai";
import { getHistory, getUserName, saveHistory } from "../services/database.ts";
import { normalizeCountryName } from "../services/plex";
import {
	extractNameFromText,
	hasNameIntent,
	shouldDisableAddActions,
} from "./intent";
import { DEFAULT_SYSTEM_PROMPT } from "./prompts";
import {
	buildExactCountPrefix,
	buildPlexBrowseAuthoritativeText,
	extractToolResultsFromMessages,
} from "./response";
import {
	detectStatusLanguage,
	formatToolCallsStatus,
	type StatusLanguage,
} from "./status";
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
 */
export async function processUserMessage(
	userId: number,
	userMessage?: string,
	onStep?: (status: string) => Promise<void>,
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
			// Save the name using the tool's execute function directly with proper arguments
			const { setUserName } = await import("../services/database");
			setUserName(userId, name);
			// Update the userName variable for this session
			// The name will be persisted in the database
		}
	}

	// Add the user's message to the history ONLY if it's a new message
	if (userMessage) {
		// Clear history if it's too long or stale
		const { trimHistory } = await import("../services/database");

		// Check for long gap (> 12 hours) from the metadata of the last message if available
		// For now, we'll just trim to keep it simple and effective.
		history = trimHistory(userId, 20);

		history.push({ role: "user", content: userMessage });
		saveHistory(userId, history);
	}

	try {
		const statusSeedText = userMessage ?? getLastUserTextFromHistory(history);
		const statusLang: StatusLanguage = detectStatusLanguage(statusSeedText);
		const isOllama = process.env.AI_PROVIDER === "ollama";
		const ollamaBaseUrl = (
			process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434"
		).replace(/\/$/, "");
		const modelFastName =
			process.env.AI_MODEL_FAST || process.env.AI_MODEL || "minimax-m2.7:cloud";
		const modelCapableName = process.env.AI_MODEL_CAPABLE || modelFastName;

		const ollamaProvider = isOllama
			? createOpenAI({ baseURL: `${ollamaBaseUrl}/v1`, apiKey: "ollama" })
			: null;

		const modelFast =
			isOllama && ollamaProvider
				? ollamaProvider(modelFastName)
				: google(modelFastName);

		const modelCapable =
			isOllama && ollamaProvider
				? ollamaProvider(modelCapableName)
				: google(modelCapableName);

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
			searchPlexByGenre: botTools.browsePlexByGenreTool,
			browsePlexByGenre: botTools.browsePlexByGenreTool, // Legacy Alias
			searchPlexByCountry: botTools.findPlexByCountryTool,
			findPlexByCountry: botTools.findPlexByCountryTool, // Legacy Alias
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
		};

		if (shouldDisableAddTools) {
			delete tools.addMovie;
			delete tools.addSeries;
		}

		// --- Defensive Tool Filtering ---
		// Ensure no tool is undefined before passing to generateText to prevent crashes in AI SDK.
		const activeToolEntries = Object.entries(tools).filter(([name, tool]) => {
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
		const { isProxyEnabled, executeOnProxy } = await import("./proxyClient");
		let finalTools = sanitizedTools;

		if (isProxyEnabled()) {
			finalTools = Object.fromEntries(
				Object.entries(sanitizedTools).map(([name, toolObject]) => {
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
		}

		const currentDate = new Date().toLocaleDateString("en-US", {
			weekday: "long",
			year: "numeric",
			month: "long",
			day: "numeric",
		});

		const firstPassParams = {
			model: modelFast as any,
			system: DEFAULT_SYSTEM_PROMPT.replace("{{userId}}", userId.toString())
				.replace("{{userName}}", userName)
				.replace("{{currentDate}}", currentDate)
				.trim(),
			messages: history,
			tools: finalTools,
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
					if (thought && thought.length <= 140 && !thought.includes("\n")) {
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
					messages: [...history, { role: "user", content: repairPrompt }],
				} as any);
			} else {
				throw error;
			}
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
				system: (
					DEFAULT_SYSTEM_PROMPT +
					"\n\nSynthesize the final response. REMEMBER: Never use 'Poster:' text placeholders. If poster URLs are present in the tool results above, include them internally using the POSTER: <url> format at the very end of your message."
				)
					.replace("{{userId}}", userId.toString())
					.replace("{{userName}}", userName)
					.replace("{{currentDate}}", currentDate)
					.trim(),
				messages: [...history, ...firstPass.response.messages],
			});

			response = synthesis;
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
			history.push(...firstPass.response.messages);
		} else {
			// Include everything from first pass PLUS the final synthesis message
			history.push(
				...firstPass.response.messages,
				...response.response.messages,
			);
		}
		saveHistory(userId, history);

		let text = response.text || "I had trouble formulating a response.";
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
						if (btnText === "✅ Yes, Add Movie") btnText = "✅ Sí, añadir película";
						else if (btnText === "✅ Yes, Add Series") btnText = "✅ Sí, añadir serie";
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
					const matchedItem =
						items.find(
							(item: any) =>
								item.title &&
								text.toLowerCase().includes(item.title.toLowerCase()),
						) || items[0];

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

		if (extractedButtons.length > 0) {
			const filteredExtracted = toolRequiresConfirmation
				? extractedButtons.filter(
						(btn) =>
							!btn.data.startsWith("notify_download_confirm_") &&
							btn.data !== "notify_download_decline",
					)
				: extractedButtons;

			buttons = buttons ? [...buttons, ...filteredExtracted] : filteredExtracted;
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
