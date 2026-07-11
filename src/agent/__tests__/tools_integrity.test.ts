import { describe, expect, test } from "bun:test";
import * as botTools from "../tools";

describe("Tool Integrity", () => {
	test("all tools referenced in the agent must be defined in tools.ts", () => {
		// This mapping should match the one in src/agent/index.ts
		const toolMapping: Record<string, any> = {
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
			searchPlexByGenre: botTools.browsePlexByGenreTool,
			browsePlexByGenre: botTools.browsePlexByGenreTool, // Legacy Alias
			searchPlexByCountry: botTools.findPlexByCountryTool,
			findPlexByCountry: botTools.findPlexByCountryTool, // Legacy Alias
			searchPlexByDuration: botTools.searchPlexByDurationTool,
			getRecentlyAddedPlex: botTools.getRecentlyAddedPlexTool,
			getPlexLibraryStats: botTools.getPlexLibraryStatsTool,
			discoverMedia: botTools.discoverMediaTool,
		};

		for (const [name, tool] of Object.entries(toolMapping)) {
			expect(tool).toBeDefined();
		}
	});
});
