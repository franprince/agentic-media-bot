// Export cache and LRU Cache helpers
export { clearCache, invalidateCachePattern, withCache, configCache } from "./cache";

// Export formatters and string helpers
export {
    formatBytes,
    formatDuration,
    getCompletionWallClock,
    formatEstimatedCompletion,
    hasNonLatinCharacters,
    pickLatinAliasCandidate,
    stripDiacritics,
    uniqueNonEmptyStrings
} from "./formatters";

// Export Radarr tools
export {
    searchMovieTool,
    addMovieTool,
    getMovieQueueTool,
    removeMovieTool,
    getMissingMoviesTool
} from "./radarr-tools";

// Export Sonarr tools
export {
    searchSeriesTool,
    addSeriesTool,
    getSeriesQueueTool,
    removeSeriesTool,
    getMissingSeriesTool,
    getMissingEpisodesTool
} from "./sonarr-tools";

// Export qBittorrent & NZBGet tools
export {
    getTorrentsTool,
    pauseTorrentTool,
    resumeTorrentTool,
    pauseAllTorrentsTool,
    resumeAllTorrentsTool,
    getNZBGetQueueTool
} from "./download-tools";

// Export Plex tools
export {
    searchPlexByTitleOnlyTool,
    browsePlexByGenreTool,
    getRecentlyAddedPlexTool,
    findPlexByCountryTool,
    searchPlexByDurationTool,
    getPlexLibraryStatsTool,
    getUnwatchedEpisodesTool,
    getPlexSessionsTool
} from "./plex-tools";

// Export Watchlist tools
export {
    getWatchlistTool,
    addToWatchlistTool,
    removeFromWatchlistTool,
    syncWatchlistTool
} from "./watchlist-tools";

// Export System & health tools
export {
    checkServiceHealthTool,
    discoverMediaTool,
    getDiskSpaceTool
} from "./system-tools";

// Export Report & subscription tools
export {
    subscribeToDownloadTool,
    subscribeToReportTool,
    unsubscribeFromReportTool,
    getReportSubscriptionsTool
} from "./reports-tools";
