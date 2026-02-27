import { generateText, type CoreMessage } from "ai";
import { google } from "@ai-sdk/google";
import { ollama } from "ollama-ai-provider";
import * as botTools from "./tools";
import { getHistory, saveHistory, getUserName } from "../services/database.ts";
import { detectStatusLanguage, formatToolCallsStatus, type StatusLanguage } from "./status";
import { buildExactCountPrefix, buildPlexBrowseAuthoritativeText, extractToolResultsFromMessages } from "./response";
import { normalizeCountryName } from "../services/plex";
import { shouldDisableAddActions, hasNameIntent, extractNameFromText } from "./intent";

import { DEFAULT_SYSTEM_PROMPT } from "./prompts";
import {
    getLastUserTextFromHistory,
    isInvalidToolArgumentsError,
    buildToolArgsRepairPrompt,
    normalizeToolCallsForLogging,
    shouldRewriteForTargetLanguage,
    buildLanguageRewritePrompt
} from "./utils";

/**
 * Process a user message using the AI agent.
 */
export async function processUserMessage(
    userId: number,
    userMessage?: string,
    onStep?: (status: string) => Promise<void>
): Promise<{ text: string, imageUrl?: string }> {
    // Retrieve conversation history for the user from SQLite
    let history = getHistory(userId);
    const userName = getUserName(userId) || "Friend";

    // --- Legacy Tool Rename Migration ---
    // We recently renamed tools (searchPlexLibrary -> searchPlexByTitleOnly, browsePlexByCountry -> findPlexByCountry)
    // To avoid confusing the model with old tool names in history, we migrate them on the fly.
    history = history.map(msg => {
        if (msg.role === "assistant" && Array.isArray(msg.content)) {
            msg.content = msg.content.map(part => {
                if (part.type === "tool-call") {
                    if (part.toolName === "searchPlexLibrary") part.toolName = "searchPlexByTitleOnly";
                    if (part.toolName === "browsePlexByCountry") part.toolName = "findPlexByCountry";
                }
                return part;
            });
        }
        if (msg.role === "tool" && Array.isArray(msg.content)) {
            msg.content = msg.content.map(part => {
                if (part.type === "tool-result") {
                    if (part.toolName === "searchPlexLibrary") part.toolName = "searchPlexByTitleOnly";
                    if (part.toolName === "browsePlexByCountry") part.toolName = "findPlexByCountry";
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
        history.push({ role: "user", content: userMessage });
        saveHistory(userId, history);
    }

    try {
        const statusSeedText = userMessage ?? getLastUserTextFromHistory(history);
        const statusLang: StatusLanguage = detectStatusLanguage(statusSeedText);
        const provider = process.env.AI_PROVIDER === "ollama" ? ollama : google;
        const modelFastName = process.env.AI_MODEL_FAST || process.env.AI_MODEL || "gemini-1.5-flash";
        const modelCapableName = process.env.AI_MODEL_CAPABLE || modelFastName;

        const modelFast = process.env.AI_PROVIDER === "ollama"
            ? ollama(modelFastName)
            : google(modelFastName);

        const modelCapable = process.env.AI_PROVIDER === "ollama"
            ? ollama(modelCapableName)
            : google(modelCapableName);

        const userName = getUserName(userId) || "Friend";

        // --- Step 1: Tool Execution Loop (using FAST model) ---
        const shouldDisableAddTools = shouldDisableAddActions(statusSeedText);
        const tools: any = {
            searchMovie: botTools.searchMovieTool,
            addMovie: botTools.addMovieTool,
            getMovieQueue: botTools.getMovieQueueTool,
            searchSeries: botTools.searchSeriesTool,
            addSeries: botTools.addSeriesTool,
            getSeriesQueue: botTools.getSeriesQueueTool,
            getTorrents: botTools.getTorrentsTool,
            pauseTorrent: botTools.pauseTorrentTool,
            resumeTorrent: botTools.resumeTorrentTool,
            checkServiceHealth: botTools.checkServiceHealthTool,
            getMissingMovies: botTools.getMissingMoviesTool,
            getMissingSeries: botTools.getMissingSeriesTool,
            getMissingEpisodes: botTools.getMissingEpisodesTool,
            searchPlexByTitleOnly: botTools.searchPlexByTitleOnlyTool,
            browsePlexByGenre: botTools.browsePlexByGenreTool,
            findPlexByCountry: botTools.findPlexByCountryTool,
            searchPlexByDuration: botTools.searchPlexByDurationTool,
            getRecentlyAddedPlex: botTools.getRecentlyAddedPlexTool,
            getPlexLibraryStats: botTools.getPlexLibraryStatsTool,
            discoverMedia: botTools.discoverMediaTool,
            saveUserName: botTools.saveUserNameTool,
        };

        if (shouldDisableAddTools) {
            delete tools.addMovie;
            delete tools.addSeries;
        }

        const firstPassParams = {
            model: modelFast as any,
            system: DEFAULT_SYSTEM_PROMPT
                .replace("{{userId}}", userId.toString())
                .replace("{{userName}}", userName)
                .trim(),
            messages: history,
            tools,
            onStepFinish: async (step: any) => {
                const thought = step.text?.trim();
                if (onStep && (thought || step.toolCalls.length > 0)) {
                    const normalizedToolCalls = normalizeToolCallsForLogging(step.toolCalls as any[]);
                    console.log(`📡 Step Tool Calls[FAST]: `, JSON.stringify(normalizedToolCalls, null, 2));

                    if (step.toolCalls.length > 0) {
                        const statusText = formatToolCallsStatus(normalizedToolCalls as any[], statusLang);
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
                    const retryStatus = statusLang === "es"
                        ? "Ups—hubo un problema con los datos de una herramienta. Reintentando..."
                        : "Oops—there was an issue with tool arguments. Retrying...";
                    await onStep(`🔄 ${retryStatus} `);
                }

                const repairPrompt = buildToolArgsRepairPrompt(error?.toolName, error?.toolArgs, statusLang);
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
        if (firstPass.toolResults.length > 0 && modelFastName !== modelCapableName) {
            if (onStep) {
                const synthesisStatus = statusLang === "es"
                    ? "✍️ _Redactando la respuesta final..._"
                    : "✍️ _Synthesizing final response..._";
                await onStep(synthesisStatus);
            }

            console.log(`🧠 Synthesizing final response with CAPABLE model: ${modelCapableName} `);

            const synthesis = await generateText({
                model: modelCapable as any,
                system: DEFAULT_SYSTEM_PROMPT
                    .replace("{{userId}}", userId.toString())
                    .replace("{{userName}}", userName)
                    .trim(),
                messages: [
                    ...history,
                    ...firstPass.response.messages,
                    { role: "user", content: "Synthesize the final response. REMEMBER: Never use 'Poster:' text placeholders. If poster URLs are present in the tool results above, include them internally using the POSTER: <url> format at the very end of your message." }
                ],
            });

            response = synthesis;
        }

        if (response.toolResults.length > 0) {
            console.log(`🛠️ Tool Results: `, JSON.stringify(response.toolResults.map((r: any) => ({
                tool: r.toolName,
                result: r.result
            })), null, 2));
        }

        // Add the agent's full response (including tool interactions) to the history
        if (response === firstPass) {
            history.push(...firstPass.response.messages);
        } else {
            // Include everything from first pass PLUS the final synthesis message
            history.push(...firstPass.response.messages, ...response.response.messages);
        }
        saveHistory(userId, history);

        let text = response.text || "I had trouble formulating a response.";
        let imageUrl: string | undefined;

        // Scrub any remaining textual placeholders the model might have hallucinated
        text = text.replace(/^(Poster|Image|Thumbnail|Poster URL):\s*.*$/gim, "");
        text = text.replace(/\[\s*(Insert|Poster|Image|Thumbnail).*\]/gi, "");
        text = text.trim();

        const extractedFromFirstPass = extractToolResultsFromMessages(firstPass?.response?.messages);
        const extractedFromFinalPass = extractToolResultsFromMessages(response?.response?.messages);
        const toolResultsForCounts = [
            ...(response.toolResults || []),
            ...(firstPass.toolResults || []),
            ...extractedFromFinalPass,
            ...extractedFromFirstPass,
        ];
        const authoritativePlexBrowseText = buildPlexBrowseAuthoritativeText(toolResultsForCounts as any[], statusLang);
        if (authoritativePlexBrowseText) {
            text = authoritativePlexBrowseText;
        }

        const exactCountPrefix = buildExactCountPrefix(toolResultsForCounts as any[], statusLang);
        if (exactCountPrefix) {
            const hasExactPrefixAlready = text.startsWith(exactCountPrefix);
            if (!hasExactPrefixAlready) {
                text = `${exactCountPrefix} \n\n${text} `.trim();
            }
        }

        // Extract poster URL if present (using a more robust regex to skip over model-added fluff)
        const posterMatch = text.match(/POSTER:.*?(https?:\/\/\S+)/i);
        if (posterMatch) {
            imageUrl = posterMatch[1];
            text = text.replace(/POSTER:.*?(https?:\/\/\S+)/i, "").trim();
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
                console.warn("Language rewrite step failed; returning original text.", rewriteError);
            }
        }

        console.log(`🤖 Bot Response to ${userId}: `, text);
        if (imageUrl) console.log(`🖼️ Attached Poster: `, imageUrl);

        return { text, imageUrl };
    } catch (error) {
        console.error("Error processing LLM response:", error);
        const fallbackLang = detectStatusLanguage(userMessage ?? getLastUserTextFromHistory(history));
        return {
            text: fallbackLang === "es"
                ? "Lo siento, tuve un error al procesar tu pedido."
                : "Sorry, I encountered an error while trying to process your request."
        };
    }
}
