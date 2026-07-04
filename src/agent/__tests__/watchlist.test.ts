import { expect, test, describe, spyOn, beforeAll, afterAll } from "bun:test";
import * as db from "../../services/database";
import * as plex from "../../services/plex";
import { getWatchlistTool, addToWatchlistTool, removeFromWatchlistTool, syncWatchlistTool } from "../tools";

describe("Watchlist SQLite Database Helpers", () => {
    beforeAll(() => {
        // Ensure clean state: delete any test items
        db.removeFromLocalWatchlist("Test Movie 123");
        db.removeFromLocalWatchlist("Test Show 123");
    });

    afterAll(() => {
        db.removeFromLocalWatchlist("Test Movie 123");
        db.removeFromLocalWatchlist("Test Show 123");
    });

    test("should insert, retrieve, update status, and remove local watchlist items", () => {
        // 1. Insert item
        db.addToLocalWatchlist({
            title: "Test Movie 123",
            media_type: "movie",
            rating_key: "test_key_123",
            imdb_id: "tttest123",
            tmdb_id: 12345,
            status: "pending"
        });

        // 2. Retrieve items
        let list = db.getLocalWatchlist();
        let item = list.find(x => x.title === "Test Movie 123");
        expect(item).toBeDefined();
        expect(item!.media_type).toBe("movie");
        expect(item!.rating_key).toBe("test_key_123");
        expect(item!.imdb_id).toBe("tttest123");
        expect(item!.tmdb_id).toBe(12345);
        expect(item!.status).toBe("pending");

        // 3. Update status
        db.updateLocalWatchlistStatus("test_key_123", "downloading");
        list = db.getLocalWatchlist();
        item = list.find(x => x.title === "Test Movie 123");
        expect(item!.status).toBe("downloading");

        // 4. Remove item
        db.removeFromLocalWatchlist("test_key_123");
        list = db.getLocalWatchlist();
        item = list.find(x => x.title === "Test Movie 123");
        expect(item).toBeUndefined();
    });
});

describe("Watchlist Plex Integration & Sync", () => {
    let getPlexWatchlistSpy: any;
    let getPlexDiscoverMetadataSpy: any;
    let addToPlexWatchlistSpy: any;
    let removeFromPlexWatchlistSpy: any;
    let searchPlexDiscoverSpy: any;

    beforeAll(() => {
        getPlexWatchlistSpy = spyOn(plex, "getPlexWatchlist");
        getPlexDiscoverMetadataSpy = spyOn(plex, "getPlexDiscoverMetadata");
        addToPlexWatchlistSpy = spyOn(plex, "addToPlexWatchlist");
        removeFromPlexWatchlistSpy = spyOn(plex, "removeFromPlexWatchlist");
        searchPlexDiscoverSpy = spyOn(plex, "searchPlexDiscover");

        db.removeFromLocalWatchlist("Inception 2");
    });

    afterAll(() => {
        getPlexWatchlistSpy.mockRestore();
        getPlexDiscoverMetadataSpy.mockRestore();
        addToPlexWatchlistSpy.mockRestore();
        removeFromPlexWatchlistSpy.mockRestore();
        searchPlexDiscoverSpy.mockRestore();

        db.removeFromLocalWatchlist("Inception 2");
    });

    test("syncWatchlist should sync items from Plex to SQLite and clean up orphaned local items", async () => {
        // Set up mock items in Plex Watchlist
        getPlexWatchlistSpy.mockImplementation(async () => [
            {
                title: "Inception 2",
                ratingKey: "key_inception_2",
                type: "movie"
            }
        ]);

        // Mock discovery metadata response to resolve external IDs
        getPlexDiscoverMetadataSpy.mockImplementation(async (key: string) => {
            if (key === "key_inception_2") {
                return {
                    Guid: [
                        { id: "imdb://tt1375666" },
                        { id: "tmdb://27205" }
                    ]
                };
            }
            return null;
        });

        // Insert a local-only item that has a ratingKey but is NOT in Plex Watchlist (should be deleted by sync)
        db.addToLocalWatchlist({
            title: "Orphaned Movie",
            media_type: "movie",
            rating_key: "orphaned_key_999",
            status: "pending"
        });

        // Run sync
        const result = await plex.syncWatchlist();
        expect(result.added).toBe(1);
        expect(result.removed).toBe(1); // Orphaned Movie should be removed

        // Verify Inception 2 is in SQLite with correct mapped IDs
        const list = db.getLocalWatchlist();
        const inception = list.find(x => x.rating_key === "key_inception_2");
        expect(inception).toBeDefined();
        expect(inception!.title).toBe("Inception 2");
        expect(inception!.imdb_id).toBe("tt1375666");
        expect(inception!.tmdb_id).toBe(27205);

        // Verify Orphaned Movie is gone
        const orphaned = list.find(x => x.rating_key === "orphaned_key_999");
        expect(orphaned).toBeUndefined();

        // Clean up Inception 2 from DB
        db.removeFromLocalWatchlist("key_inception_2");
    });

    test("addToWatchlistTool should search Plex Discover and add the match to Plex Watchlist and SQLite", async () => {
        searchPlexDiscoverSpy.mockImplementation(async () => [
            {
                title: "Inception 2",
                ratingKey: "key_inception_2",
                type: "movie",
                year: 2010
            }
        ]);
        addToPlexWatchlistSpy.mockImplementation(async () => true);
        getPlexDiscoverMetadataSpy.mockImplementation(async () => ({
            Guid: [{ id: "imdb://tt1375666" }]
        }));

        const result = await addToWatchlistTool.execute!({ title: "Inception 2", mediaType: "movie" }, {} as any);
        expect(result.success).toBe(true);
        expect(result.message).toContain("Added \"Inception 2\"");

        // Check if added to SQLite
        const list = db.getLocalWatchlist();
        const item = list.find(x => x.rating_key === "key_inception_2");
        expect(item).toBeDefined();
        expect(item!.imdb_id).toBe("tt1375666");

        db.removeFromLocalWatchlist("key_inception_2");
    });
});
