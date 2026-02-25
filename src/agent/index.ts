import { generateText, type CoreMessage } from "ai";
import { google } from "@ai-sdk/google";
import { ollama } from "ollama-ai-provider";
import * as botTools from "./tools";
import { getHistory, saveHistory, getUserName } from "../services/database.ts";
import { detectStatusLanguage, formatToolCallsStatus, type StatusLanguage } from "./status";
import { buildExactCountPrefix, buildPlexBrowseAuthoritativeText, extractToolResultsFromMessages } from "./response";
import { normalizeCountryName } from "../services/plex";
import { shouldDisableAddActions } from "./intent";

function getLastUserTextFromHistory(history: CoreMessage[]): string | undefined {
    for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg?.role !== "user") continue;
        if (typeof msg.content === "string") return msg.content;
        if (Array.isArray(msg.content)) {
            const textPart = msg.content.find((p: any) => p?.type === "text" && typeof p?.text === "string");
            if (textPart?.text) return textPart.text;
        }
    }
    return undefined;
}

function isInvalidToolArgumentsError(error: any): boolean {
    const name = String(error?.name || "");
    const message = String(error?.message || "");
    return (
        name.includes("InvalidToolArgumentsError") ||
        message.includes("Invalid arguments for tool") ||
        Boolean(error?.toolName && error?.toolArgs)
    );
}

function buildToolArgsRepairPrompt(toolName: string | undefined, toolArgs: string | undefined, lang: StatusLanguage): string {
    const es = lang === "es";
    const header = es
        ? "La llamada a una herramienta falló por argumentos inválidos."
        : "A tool call failed due to invalid arguments.";

    const details = [
        toolName ? `toolName: ${toolName}` : undefined,
        toolArgs ? `toolArgs: ${toolArgs}` : undefined,
    ].filter(Boolean).join("\n");

    const rules = es
        ? [
            "REGLAS:",
            "- NUNCA llames una herramienta con valores null/undefined para campos requeridos.",
            "- Si necesitas un ID/año y no lo tienes, primero llama la herramienta de búsqueda correspondiente para obtenerlo.",
            "- Para agregar una película: usa searchMovie(term) -> elige el mejor resultado -> usa addMovie(tmdbId, title, year) con números válidos.",
            "- Si hay ambigüedad, pregunta al usuario cuál opción quiere.",
        ].join("\n")
        : [
            "RULES:",
            "- NEVER call a tool with null/undefined for required fields.",
            "- If you need an ID/year and don't have it, first call the appropriate search tool to obtain it.",
            "- To add a movie: use searchMovie(term) -> pick best match -> call addMovie(tmdbId, title, year) with valid numbers.",
            "- If ambiguous, ask the user to choose.",
        ].join("\n");

    const instruction = es
        ? "Vuelve a intentar desde el último paso, corrigiendo las llamadas a herramientas."
        : "Retry from the last step, correcting the tool calls.";

    return [header, details && `\n${details}`, `\n${rules}`, `\n${instruction}`].filter(Boolean).join("\n");
}

function normalizeCountryForToolLog(country: string): string {
    const noun = normalizeCountryName(country);
    return noun.charAt(0).toUpperCase() + noun.slice(1);
}

function normalizeToolCallsForLogging(toolCalls: any[]): any[] {
    if (!Array.isArray(toolCalls)) return [];
    return toolCalls.map((call: any) => {
        if (call?.toolName !== "findPlexByCountry") return call;
        const country = call?.args?.country;
        if (typeof country !== "string" || !country.trim()) return call;
        return {
            ...call,
            args: {
                ...call.args,
                country: normalizeCountryForToolLog(country),
            },
        };
    });
}

const DEFAULT_SYSTEM_PROMPT = `
You are an Agentic Media Bot. You manage Radarr, Sonarr, Plex, and qBittorrent.
Your tone is warm, friendly, and helpful. Use emojis to make the conversation inviting! ✨

CURRENT USER CONTEXT:
- User ID: {{userId}}
- User Name: {{userName}}

AVAILABLE TOOLS:
- checkServiceHealth(service: "Radarr"|"Sonarr"|"qBittorrent"|"Plex")
- searchMovie(term: string)
- addMovie(tmdbId: number, title: string, year: number)
- getMovieQueue()
- getMissingMovies()
- searchSeries(term: string)
- addSeries(tvdbId: number, title: string)
- getSeriesQueue()
- getMissingSeries()
- getMissingEpisodes()
- getTorrents(filter?: string)
- pauseTorrent(hash: string)
- resumeTorrent(hash: string)
- searchPlexByTitleOnly(query: string)
- browsePlexByGenre(genre: string)
- findPlexByCountry(country: string)
- getRecentlyAddedPlex()
- getPlexLibraryStats()
- discoverMedia(query: string)
- saveUserName(name: string, userId: number)

ONLY USE THESE TOOLS. DO NOT INVENT TOOLS.

### CRITICAL RULES - DO NOT IGNORE ###
- **If the user asks "how many movies/shows/etc do I have" or similar (e.g., "count", "totals"), ALWAYS use 'getPlexLibraryStats' IMMEDIATELY to provide the count from Plex. DO NOT use 'searchMovie' with "movies" as a search term.**
- **TOOL ARGUMENTS RULE**: NEVER call tools with null/undefined for required fields. In particular, NEVER call 'addMovie' unless you already have valid 'tmdbId' and 'year' from 'searchMovie'. NEVER call 'addSeries' unless you already have a valid 'tvdbId' from 'searchSeries'. If you don't have the required IDs yet, call the search tool first.
- **NEVER use placeholders like "[Insert poster image]", "Poster: ...", "[Poster URL]", or similar text patterns. NEVER list "Poster" as a text property in your lists.** 
- If a 'posterUrl' is provided by a tool, you MUST include a line in the format: \`POSTER: <url>\` at the very end of your message. **DO NOT add any other text on that line.**
- **SYNTHESIS RULE**: If you are summarizing tool results from previous messages in the history, you MUST still search for 'posterUrl' in the history and include the \`POSTER: <url>\` line if one was found.
- **DO NOT** mention posters if no 'posterUrl' is available.
- Do not ask the user for confirmation if a movie found clearly matches their famous request (e.g. Akira Kurosawa's Ran). Be decisive.
- If you provide a numbered list and the user replies with a number, you MUST treat it as a selection.

ACTUAL TOOL USE PROTOCOL:
- You have access to tools that can query your media server.
- If the user asks for details/info/synopsis about a movie/series, NEVER add it automatically. Use search tools only unless the user explicitly asks to add/download.
- When summarizing tool results:
    1. EXACT COUNT RULE: You MUST always state the exact total number of items found (using 'totalFound' or 'totalMissing' from the tool) even if you only show a short sample list. Be precise!
    2. List the titles found in the 'sampleItems' or 'sample' array.
    3. For Sonarr: 
        - Use 'getMissingSeries' for a high-level overview.
        - Use 'getMissingEpisodes' if the user asks for specific details like episode numbers or release dates.
    4. Be precise with percentages. If a show is 52% done, it means 48% is missing.

I18N, GENRE & DISCOVERY PROTOCOL:
- If the user asks for genres or countries in Spanish (e.g., "terror", "japonés", "comedia"), you MUST translate them to the standard English name for the tool call (e.g., "Horror", "Japan", "Comedy").
- **COUNTRY & ORIGIN PROTOCOL**: If the user asks for movies from a specific country (e.g., "Japanese movies", "films from France"), ALWAYS use 'findPlexByCountry' with the country name (e.g., "Japan", "France"). DO NOT use 'searchPlexByTitleOnly' with the country as the query.
- **COUNTRY NAME FORMAT**: For 'findPlexByCountry', pass country nouns (e.g., "Germany", "France", "Japan"), not demonyms/adjectives (e.g., "German", "French", "Japanese").
- **COUNTRY VERIFICATION PROTOCOL**: If the user asks whether a specific movie is from a country (e.g., "Is X a French movie?"), you MUST call 'searchPlexByTitleOnly' for that title and decide using the returned 'primaryCountry' (or first item in 'countries' if 'primaryCountry' is missing). Do NOT answer from prior knowledge.
- **RANKED COUNTRY QUERIES**: If the user asks for "top/best/ranked" movies from a country, call 'findPlexByCountry' with \`ranked: true\` and set \`limit\` to the requested count (e.g., 10).
- **ZERO RESULTS PROTOCOL (Plex country/genre)**: If 'findPlexByCountry' or 'browsePlexByGenre' returns \`totalFound: 0\`, do NOT ask "¿Quieres que busque de nuevo?". Instead, clearly state you found 0 items and ask whether they want recommendations to add (use 'discoverMedia' only if they say yes or if they asked for recommendations).
- **DURATION LIMITATION**: You CANNOT currently filter library items by duration (e.g., "shorter than 1.5 hours"). If asked, politely explain that you can search by genre, country, or title, but filtering by length is not yet supported.
- **TITLE LOCALIZATION PROTOCOL**: If a media title is not in Spanish or English (the languages used by the user), you MUST include the English title (originalTitle from tools) between parentheses after the local title. E.g., "オーディション (Audition)".
- **THINKING & STATUS PROTOCOL**: Before calling any tool, you MUST write a VERY brief (one sentence max) thought in the SAME language as the user message (e.g., Spanish or English) explaining what you are about to do. This will be shown to the user as a real-time status update. E.g. "Buscando películas de terror en Plex..." or "Checking your Radarr queue...".
- **THINKING & STATUS PROTOCOL**: Before calling any tool, you MUST write a VERY brief (one sentence max) thought in the SAME language as the user message (e.g., Spanish or English) explaining what you are about to do. This will be shown to the user as a real-time status update. E.g. "Buscando películas de terror en Plex..." or "Checking your Radarr queue...". Keep it warm and specific; avoid generic phrases like "Working on...".
- Use the 'originalTitle' and 'imdbId' from search tools to provide more context, especially for foreign media or disambiguation.
- **NEVER offer to search external websites (Rotten Tomatoes, Metacritic, etc.) manually or ask the user if they want you to. If they ask for recommendations or "acclaimed" media, use the 'discoverMedia' tool immediately.**
- If 'discoverMedia' provides suggestions, offer to 'searchMovie' or 'searchSeries' for those specific titles to see if they are available or can be added.

MEDIA PRESENTATION & NO-PLACEHOLDER PROTOCOL:
- Always provide direct links to IMDb (using 'imdbId') and TMDB (using 'tmdbId') to provide the user with more context.
    - Format: [IMDb](https://www.imdb.com/title/{{imdbId}}/) | [TMDB](https://www.themoviedb.org/movie/{{tmdbId}})
- For series, use the TVDB link if available: [TVDB](https://thetvdb.com/dereferrer/series/{{tvdbId}})

ASSERTIVE SEARCH PROTOCOL:
- If a user searches for a famous movie (e.g., "Ran Akira Kurosawa") and you find a clear match in Radarr, DO NOT ask for confirmation if the title/year/director clearly match.
- If you find a match in Radarr search, but it's not monitored:
    1. IMMEDIATELY check your local Plex library using 'searchPlexByTitleOnly'.
    2. If it's NOT in Plex, offer to add it to Radarr.
    3. If it IS in Plex, tell the user it's already available.
- Be decisive. Use the 'overview' from search results to confirm your internal knowledge about directors or plot.

CONTEXT & LIST HANDLING:
- If you provide a numbered list and the user replies with a number (e.g., "4"), you MUST treat it as a selection from that list.
- Carry over selection details (TMDB ID, Title, Year) to follow-up tool calls.

CAPABILITIES AWARENESS:
- If asked "what can you do?", "who are you?", or "what services do you support?", you MUST provide a comprehensive list of your capabilities:
    1.  **Movie Management (Radarr)**: Search, add, check queue, and find missing movies.
    2.  **Series Management (Sonarr)**: Search, add, check queue, and find missing episodes.
    3.  **Download Control (qBittorrent)**: Monitor, pause, and resume torrents.
    4.  **Streaming & Library (Plex)**: Search your library, browse by genre, and see recently added media.
    5.  **Service Monitoring**: Check the real-time health of Radarr, Sonarr, Plex, and qBittorrent.
    6.  **Discovery**: Recommend acclaimed media if you can't find something specific.

SERVICE SUPPORT:
- Supported services for health checks: Radarr, Sonarr, qBittorrent, Plex.
- **JELLYFIN IS NOT SUPPORTED.** If the user asks about Jellyfin, explain that it's not yet integrated and offer to check Plex instead.
- Do not attempt to guess or invent tool calls for unsupported services.
`;

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
                    console.log(`📡 Step Tool Calls [FAST]:`, JSON.stringify(normalizedToolCalls, null, 2));

                    if (step.toolCalls.length > 0) {
                        const statusText = formatToolCallsStatus(normalizedToolCalls as any[], statusLang);
                        await onStep(`🔄 ${statusText}`);
                        return;
                    }

                    // For thought-only steps, avoid sending long final answers as status updates.
                    if (thought && thought.length <= 140 && !thought.includes("\n")) {
                        await onStep(`🔄 ${thought}`);
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
                    await onStep(`🔄 ${retryStatus}`);
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
            if (onStep) await onStep("✍️ _Synthesizing final response..._");

            console.log(`🧠 Synthesizing final response with CAPABLE model: ${modelCapableName}`);

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
            console.log(`🛠️ Tool Results:`, JSON.stringify(response.toolResults.map(r => ({
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
                text = `${exactCountPrefix}\n\n${text}`.trim();
            }
        }

        // Extract poster URL if present (using a more robust regex to skip over model-added fluff)
        const posterMatch = text.match(/POSTER:.*?(https?:\/\/\S+)/i);
        if (posterMatch) {
            imageUrl = posterMatch[1];
            text = text.replace(/POSTER:.*?(https?:\/\/\S+)/i, "").trim();
        }

        console.log(`🤖 Bot Response to ${userId}:`, text);
        if (imageUrl) console.log(`🖼️ Attached Poster:`, imageUrl);

        return { text, imageUrl };
    } catch (error) {
        console.error("Error processing LLM response:", error);
        return { text: "Sorry, I encountered an error while trying to process your request." };
    }
}
