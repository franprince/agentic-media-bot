import * as plex from "./services/plex";

async function investigatePlexSearch() {
    console.log("🔍 Investigating Plex Search results for 'horror'...\n");
    try {
        const results = await plex.searchPlex("horror");
        console.log("Results Metadata:", JSON.stringify(results.Metadata || [], null, 2));
    } catch (error) {
        console.error("Error searching Plex:", error);
    }
}

investigatePlexSearch();
