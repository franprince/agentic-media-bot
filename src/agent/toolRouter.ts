import { type CoreMessage, generateText } from "ai";

/**
 * Tool routing — sends the model only the tools (and prompt sections) a message
 * can need, instead of all ~40 tool schemas on every request.
 *
 * Order of evidence, cheapest first:
 *   1. Keywords in the message (Spanish + English), no model call.
 *   2. Conversation context: short follow-ups ("4", "sí", a button callback)
 *      inherit the groups of the tools used in the previous turn.
 *   3. A tiny classifier request (group names only) when 1 and 2 find nothing.
 *   4. The full tool set if everything above fails.
 *
 * The agent loop adds one more safety net: a narrowed model can answer
 * NEED_MORE_TOOLS and is then re-run with a wider set (see index.ts).
 */

export type ToolGroup =
	| "movies"
	| "series"
	| "library"
	| "discovery"
	| "downloads"
	| "system"
	| "watchlist"
	| "reports"
	| "ersatztv";

export const TOOL_GROUPS: Record<ToolGroup, string[]> = {
	movies: [
		"searchMovie",
		"addMovie",
		"removeMovie",
		"getMovieQueue",
		"getMissingMovies",
		"searchPlexByTitleOnly",
		"subscribeToDownload",
	],
	series: [
		"searchSeries",
		"addSeries",
		"removeSeries",
		"getSeriesQueue",
		"getMissingSeries",
		"getMissingEpisodes",
		"getUnwatchedEpisodes",
		"searchPlexByTitleOnly",
		"subscribeToDownload",
	],
	library: [
		"searchPlexByTitleOnly",
		"searchPlexByGenre",
		"searchPlexByCountry",
		"searchPlexByDuration",
		"getRecentlyAddedPlex",
		"getPlexLibraryStats",
		"getUnwatchedEpisodes",
		"getPlexSessions",
	],
	discovery: ["discoverMedia", "searchPlexByTitleOnly"],
	downloads: [
		"getTorrents",
		"pauseTorrent",
		"resumeTorrent",
		"pauseAllTorrents",
		"resumeAllTorrents",
		"getNZBGetQueue",
		"getMovieQueue",
		"getSeriesQueue",
	],
	system: ["checkServiceHealth", "getDiskSpace"],
	watchlist: [
		"getWatchlist",
		"addToWatchlist",
		"removeFromWatchlist",
		"syncWatchlist",
	],
	reports: [
		"subscribeToReport",
		"unsubscribeFromReport",
		"getReportSubscriptions",
	],
	ersatztv: ["getErsatzTVStatus", "getErsatzTVGuide", "channelDirector"],
};

export const ALL_GROUPS = Object.keys(TOOL_GROUPS) as ToolGroup[];

/** One-line group descriptions, used by the classifier request. */
const GROUP_DESCRIPTIONS: Record<ToolGroup, string> = {
	movies:
		"a specific movie: search it, add/download it, remove it, Radarr queue, missing movies",
	series:
		"a specific TV series/anime: search, add/download, remove, Sonarr queue, missing or unwatched episodes",
	library:
		"what is already in the Plex library: by title, genre, country, duration, recently added, counts, who is watching",
	discovery: "recommendations or suggestions of what to watch or add",
	downloads: "torrent / NZBGet download queue, progress, pause, resume",
	system: "service health (online/offline) and disk space",
	watchlist: "the Plex watchlist: show, add, remove, sync",
	reports: "recurring summary reports: subscribe, unsubscribe, list",
	ersatztv: "ErsatzTV live TV channels: status, guide, build a channel",
};

/** Groups a follow-up turn may need after a given tool ran. */
const FOLLOW_UP_GROUPS: Record<string, ToolGroup[]> = {
	// A numbered pick from a recommendation list is usually "check / add it".
	discoverMedia: ["discovery", "movies", "series"],
	searchPlexByTitleOnly: ["library", "movies", "series"],
	getUnwatchedEpisodes: ["library", "series"],
	getMovieQueue: ["movies", "downloads"],
	getSeriesQueue: ["series", "downloads"],
	subscribeToDownload: ["movies", "series"],
};

const LEGACY_TOOL_NAMES: Record<string, string> = {
	searchPlexLibrary: "searchPlexByTitleOnly",
	browsePlexByGenre: "searchPlexByGenre",
	browsePlexByCountry: "searchPlexByCountry",
	findPlexByCountry: "searchPlexByCountry",
};

function normalize(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "");
}

type KeywordRule = {
	pattern: RegExp;
	groups: ToolGroup[];
	/** Applies only if no earlier rule already picked one of `groups`. */
	onlyIfNoneOf?: boolean;
};

// Patterns run against lowercased, accent-stripped text.
const KEYWORD_RULES: KeywordRule[] = [
	{
		pattern: /\b(peliculas?|pelis?|movies?|films?|filmes?|cine)\b/,
		groups: ["movies"],
	},
	{
		pattern:
			/\b(series?|shows?|tv shows?|temporadas?|seasons?|episod\w*|capitulos?|animes?|doramas?|novelas?)\b/,
		groups: ["series"],
	},
	{
		// "Get / remove this title" without saying movie or series: offer both.
		// If the message already said which ("agregá la película X"), skip.
		pattern:
			/\b(agreg\w*|anad\w*|sum(a|ar|ame|alo|ala)|baj(a|ar|ame|alo|ala|ate)|descarg(a|ar|ame|alo|ala|ue|uen)|consegui\w*|consigue\w*|add|get me|grab|download( it| this| that)?|borr\w*|elimin\w*|quit(a|ar|ame|alo|ala)|sac(a|ar|ame|alo|ala)|remove|delete|notify_download_\w+|add_(movie|series)\w*|remove_(movie|series)\w*)\b/,
		groups: ["movies", "series"],
		onlyIfNoneOf: true,
	},
	{
		pattern: /\b(faltan?|faltantes?|missing|incomplet\w*)\b/,
		groups: ["movies", "series"],
		onlyIfNoneOf: true,
	},
	{
		pattern:
			/\b(plex|biblioteca|libreria|library|coleccion|collection|ten(go|es|emos|ias?)|hay|do (i|we) have|have (i|we) got|got any|is there|cuant[oa]s?|how many|count|total(es)?|generos?|genres?|recien\w*|recently|ultim[oa]s?|latest|nuev[oa]s?|new|sin ver|no vi|unwatched|not watched|vist[oa]s?|watched|viendo|watching|reproduc\w*|playing|streams?|sesion(es)?|sessions?|duracion|duration|dura[n]?|minutos?|minutes?|horas?|hours?|cort[oa]s?|larg[oa]s?|short(est|er)?|long(est|er)?)\b/,
		groups: ["library"],
	},
	{
		// Genres.
		pattern:
			/\b(terror|horror|comedias?|comedy|comedies|dramas?|accion|action|thrillers?|suspenso|documental(es)?|documentar(y|ies)|animacion|animation|animad[oa]s?|ciencia ficcion|sci-?fi|science fiction|fantasia|fantasy|romance|romantic[oa]s?|musical(es)?|western|crimen|crime|misterio|mystery|aventuras?|adventure|belic[oa]s?|war|familiar(es)?|family|infantil(es)?|kids)\b/,
		groups: ["library", "discovery"],
	},
	{
		// Countries, demonyms and "from <place>" phrasing.
		pattern:
			/\b(japon\w*|japan\w*|franc\w*|french|aleman\w*|german\w*|espan\w*|spain|spanish|ital\w*|corea\w*|korea\w*|argentin\w*|chin[oa]s?|china|chinese|brit\w*|ingles\w*|english|inglaterra|england|uk|usa|estados unidos|american[oa]?s?|estadounidenses?|mexic\w*|brasil\w*|brazil\w*|rus(o|a|os|as|ia)|russia\w*|india|indian[oa]?s?|hindu(es)?|suec\w*|swed\w*|dan(es|esa|eses)|danish|denmark|dinamarca|norueg\w*|norw\w*|iran\w*|turc\w*|turk\w*|polac\w*|polish|poland|polonia|canad\w*|austral\w*|pais(es)?|countr(y|ies)|nacionalidad|extranjer[oa]s?|foreign)\b/,
		groups: ["library"],
	},
	{
		pattern:
			/\b(recomend\w*|recommend\w*|suger\w*|suggest\w*|que (puedo |podemos )?(veo|ver|miro|mirar)|what (should|can|to) (i |we )?watch|aclamad[oa]s?|acclaimed|mejores|best|top|similar(es)?|parecid[oa]s?|algo (como|para ver)|something (like|to watch))\b/,
		groups: ["discovery"],
	},
	{
		pattern:
			/\b(torrents?|qbit\w*|nzb\w*|usenet|descargas|downloads|downloading|descargando|bajando|cola|queue|paus\w*|resum\w*|reanud\w*|velocidad|speed|eta|progreso|progress)\b/,
		groups: ["downloads"],
	},
	{
		pattern:
			/\b(salud|health|online|offline|caid[oa]s?|down|funciona\w*|working|status|estado|servicios?|services?|disco|disk|espacio|space|storage|almacenamiento|radarr|sonarr|plex|qbittorrent|nzbget)\b/,
		groups: ["system"],
	},
	{
		pattern:
			/\b(watchlist|lista de seguimiento|mi lista|my list|ver (mas tarde|despues)|watch later)\b/,
		groups: ["watchlist"],
	},
	{
		pattern:
			/\b(reportes?|reports?|resumen(es)?|summar(y|ies)|suscri\w*|subscri\w*|desuscri\w*|unsubscri\w*|cron|semanal(es)?|weekly|diari[oa]s?|daily)\b/,
		groups: ["reports"],
	},
	{
		pattern:
			/\b(ersatz\w*|canal(es)?|channels?|iptv|guia|guide|programacion|programming|tv en vivo|live tv)\b/,
		groups: ["ersatztv"],
	},
];

// Greetings, thanks and "what can you do" need no tools at all.
const CHAT_ONLY_PATTERN =
	/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hello|hi|hey|gracias|muchas gracias|thanks|thank you|ok|okay|dale|genial|perfecto|great|cool|chau|adios|bye|que (podes|puedes|sabes) hacer|what can you do|who are you|quien (sos|eres)|ayuda|help|(me llamo|mi nombre es|soy|my name is|i am|i'm) \w+)[\s!.?¡¿,]*$/;

/** Groups suggested by keywords in the message. */
export function keywordGroups(message: string): Set<ToolGroup> {
	const text = normalize(message);
	const groups = new Set<ToolGroup>();
	for (const rule of KEYWORD_RULES) {
		if (!rule.pattern.test(text)) continue;
		if (rule.onlyIfNoneOf && rule.groups.some((group) => groups.has(group))) {
			continue;
		}
		for (const group of rule.groups) groups.add(group);
	}
	return groups;
}

/** True for greetings, thanks and capability questions. */
export function isChatOnlyMessage(message: string): boolean {
	return CHAT_ONLY_PATTERN.test(normalize(message).trim());
}

/**
 * True when a message only makes sense with the previous turn: a list pick,
 * a yes/no, a button callback, or a few words.
 */
export function isFollowUpMessage(message: string, maxWords = 6): boolean {
	const text = normalize(message).trim();
	if (!text) return false;
	if (/^\d+[.)]?$/.test(text)) return true;
	if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(text)) return true;
	return text.split(/\s+/).length <= maxWords;
}

function groupsForTool(toolName: string): ToolGroup[] {
	const name = LEGACY_TOOL_NAMES[toolName] ?? toolName;
	if (FOLLOW_UP_GROUPS[name]) return FOLLOW_UP_GROUPS[name];
	return ALL_GROUPS.filter((group) => TOOL_GROUPS[group].includes(name));
}

/**
 * Groups of the tools called in the most recent turn that used any.
 * `history` must not include the message being routed.
 */
export function contextGroups(
	history: CoreMessage[],
	maxTurnsBack = 2,
): Set<ToolGroup> {
	const groups = new Set<ToolGroup>();
	let turnsSeen = 0;
	for (let i = history.length - 1; i >= 0; i--) {
		const message = history[i];
		if (!message) continue;
		if (message.role === "assistant" && Array.isArray(message.content)) {
			for (const part of message.content as any[]) {
				if (part?.type === "tool-call" && typeof part.toolName === "string") {
					for (const group of groupsForTool(part.toolName)) groups.add(group);
				}
			}
		}
		if (message.role === "user") {
			turnsSeen++;
			if (groups.size > 0 || turnsSeen >= maxTurnsBack) break;
		}
	}
	return groups;
}

/**
 * Asks the model which groups a message needs. Costs roughly 300 tokens —
 * far less than sending every tool schema. Returns null on any failure.
 */
export async function classifyGroups(
	message: string,
	model: any,
): Promise<Set<ToolGroup> | null> {
	try {
		const catalogue = ALL_GROUPS.map(
			(group) => `- ${group}: ${GROUP_DESCRIPTIONS[group]}`,
		).join("\n");
		const result = await generateText({
			model,
			system: `You route a message for a media-server assistant (Radarr, Sonarr, Plex, downloads). Reply with the names of the tool groups needed to answer it, comma-separated, or "none" for small talk. A bare title means the user wants that movie or series. Groups:\n${catalogue}`,
			messages: [{ role: "user", content: message.slice(0, 500) }],
			maxTokens: 400,
			maxRetries: 1,
		});
		const answer = normalize(result.text || "");
		const groups = new Set<ToolGroup>();
		for (const group of ALL_GROUPS) {
			if (new RegExp(`\\b${group}\\b`).test(answer)) groups.add(group);
		}
		if (groups.size === 0 && !/\bnone\b/.test(answer)) return null;
		return groups;
	} catch (error: any) {
		console.warn(
			`⚠️ Tool group classifier failed (${error?.message || error}); using the full tool set.`,
		);
		return null;
	}
}

export type RoutingSource =
	| "chat"
	| "keyword"
	| "context"
	| "classifier"
	| "fallback";

export type RoutingDecision = {
	groups: ToolGroup[];
	source: RoutingSource;
	/** False when every tool is offered, so there is nothing to widen to. */
	narrowed: boolean;
};

const MAX_KEYWORD_GROUPS = 5;

/**
 * Decides which tool groups a message gets.
 * `priorHistory` is the conversation *before* this message.
 */
export async function selectToolGroups(
	message: string,
	priorHistory: CoreMessage[],
	model?: any,
): Promise<RoutingDecision> {
	const everything: RoutingDecision = {
		groups: [...ALL_GROUPS],
		source: "fallback",
		narrowed: false,
	};
	if (!message?.trim()) return everything;

	const fromKeywords = keywordGroups(message);
	// A message with its own keywords is usually a new request; it only inherits
	// the previous turn's tools when it is clearly a reply (a pick, a callback,
	// two or three words). Without keywords, any short message is a reply.
	const followUp =
		fromKeywords.size > 0
			? isFollowUpMessage(message, 3)
			: isFollowUpMessage(message);
	const fromContext = followUp ? contextGroups(priorHistory) : new Set<ToolGroup>();

	if (fromKeywords.size >= MAX_KEYWORD_GROUPS) return everything;

	if (fromKeywords.size > 0) {
		const groups = new Set([...fromKeywords, ...fromContext]);
		return { groups: [...groups], source: "keyword", narrowed: true };
	}

	if (isChatOnlyMessage(message)) {
		return { groups: [], source: "chat", narrowed: true };
	}

	if (fromContext.size > 0) {
		return { groups: [...fromContext], source: "context", narrowed: true };
	}

	if (model) {
		const classified = await classifyGroups(message, model);
		if (classified) {
			return { groups: [...classified], source: "classifier", narrowed: true };
		}
	}

	return everything;
}

/** Filters a tool map down to the tools of the given groups. */
export function pickToolsForGroups<T>(
	tools: Record<string, T>,
	groups: ToolGroup[],
): Record<string, T> {
	const allowed = new Set<string>();
	for (const group of groups) {
		for (const name of TOOL_GROUPS[group] ?? []) allowed.add(name);
	}
	const picked: Record<string, T> = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (allowed.has(name)) picked[name] = tool;
	}
	return picked;
}

/** Tool names not covered by any group — must stay empty (see tests). */
export function ungroupedTools(toolNames: string[]): string[] {
	const grouped = new Set(Object.values(TOOL_GROUPS).flat());
	return toolNames.filter((name) => !grouped.has(name));
}
