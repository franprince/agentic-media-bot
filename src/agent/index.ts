import { generateText, type CoreMessage } from "ai";
import { google } from "@ai-sdk/google";
import { ollama } from "ollama-ai-provider";
import * as botTools from "./tools";

const DEFAULT_SYSTEM_PROMPT = `
You are an Agentic Media Bot. You manage Radarr, Sonarr, Plex, and qBittorrent.

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
- searchPlexLibrary(query: string)
- browsePlexByGenre(genre: string)
- getRecentlyAddedPlex()

ONLY USE THESE TOOLS. DO NOT INVENT TOOLS.

ACTUAL TOOL USE PROTOCOL:
- You have access to tools that can query your media server.
- When summarizing tool results:
    1. USE THE 'totalFound' or 'totalMissing' fields provided by the tool directly.
    2. List the titles found in the 'sampleItems' or 'sample' array.
    3. For Sonarr: 
        - Use 'getMissingSeries' for a high-level overview.
        - Use 'getMissingEpisodes' if the user asks for specific details like episode numbers or release dates.
    4. Be precise with percentages. If a show is 52% done, it means 48% is missing.

I18N & GENRE PROTOCOL:
- If the user asks for genres in Spanish (e.g., "terror", "comedia"), you MUST translate them to the standard English genre name for the tool call (e.g., "Horror", "Comedy").
- Use the 'originalTitle' and 'imdbId' from search tools to provide more context, especially for foreign media or disambiguation.

If the user asks for a genre search, use 'browsePlexByGenre' (always in English).
If the search returns results, summarize them accurately using the provided counts.
If results are empty, say so and offer to check Radarr.
`;

// In-memory conversation history store (for demonstration/simplicity)
// In production, this would be backed by a database to persist across restarts.
const conversationStore = new Map<number, CoreMessage[]>();

export async function processUserMessage(userId: number, userMessage: string): Promise<string> {
    // Retrieve or initialize conversation history for the user
    let history = conversationStore.get(userId);
    if (!history) {
        history = [];
        conversationStore.set(userId, history);
    }

    // Add the user's message to the history
    history.push({ role: "user", content: userMessage });

    try {
        const modelName = process.env.AI_MODEL || "gemini-2.5-flash";
        const useOllama = process.env.AI_PROVIDER === "ollama";
        const model = useOllama
            ? ollama(process.env.OLLAMA_MODEL || "llama3.1")
            : google(modelName);

        const response = await generateText({
            model: model as any,
            system: DEFAULT_SYSTEM_PROMPT.trim(),
            messages: history,
            tools: {
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
                searchPlexLibrary: botTools.searchPlexLibraryTool,
                browsePlexByGenre: botTools.browsePlexByGenreTool,
                getRecentlyAddedPlex: botTools.getRecentlyAddedPlexTool,
            },
            onStepFinish: (step) => {
                if (step.toolCalls.length > 0) {
                    console.log(`📡 Step Tool Calls:`, JSON.stringify(step.toolCalls, null, 2));
                }
                if (step.toolResults.length > 0) {
                    console.log(`📥 Step Tool Results:`, JSON.stringify(step.toolResults, null, 2));
                }
            },
            maxSteps: 5,
        });

        console.log(`🤖 AI Response:`, JSON.stringify({
            text: response.text,
            toolCalls: response.toolCalls,
            finishReason: response.finishReason
        }, null, 2));

        if (response.toolResults.length > 0) {
            console.log(`🛠️ Tool Results:`, JSON.stringify(response.toolResults.map(r => ({
                tool: r.toolName,
                result: r.result
            })), null, 2));
        }

        // Add the agent's full response (including tool interactions) to the history
        history.push(...response.response.messages);

        if (response.text) {
            return response.text;
        }

        return "I had trouble formulating a response.";
    } catch (error) {
        console.error("Error processing LLM response:", error);
        return "Sorry, I encountered an error while trying to process your request.";
    }
}
