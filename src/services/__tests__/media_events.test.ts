import { expect, test, describe, afterEach } from "bun:test";
import { saveMediaEvent, getRecentMediaEvents } from "../database";
import { Database } from "bun:sqlite";
import { join } from "path";

// Access the same SQLite DB used by the service to clean up after tests.
// This prevents cross-test contamination when Bun runs test files in parallel.
const db = new Database(join("data", "bot_data.sqlite"));

function cleanupService(service: string) {
    db.run("DELETE FROM media_events WHERE service = ?", [service]);
}

describe("saveMediaEvent — deduplication and timestamp format", () => {
    let service: string;

    afterEach(() => {
        if (service) cleanupService(service);
    });

    test("should save a media event and retrieve it with a valid ISO-8601 timestamp", () => {
        service = `test_ts_${Date.now()}_${Math.random()}`;
        const before = new Date();

        saveMediaEvent(service, "library.new", "Inception", "Inception added");

        const events = getRecentMediaEvents(service, 5);
        expect(events.length).toBe(1);

        const ev = events[0]!;
        expect(ev.title).toBe("Inception");

        // Timestamp must be parseable as a real date (no Invalid Date)
        const parsed = new Date(ev.timestamp);
        expect(isNaN(parsed.getTime())).toBe(false);

        const after = new Date();
        expect(parsed.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
        expect(parsed.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);
    });

    test("should deduplicate identical events fired within 60 seconds", () => {
        service = `test_dedup_${Date.now()}_${Math.random()}`;
        const title = `Gonin_${Date.now()}`;

        // Simulate Plex sending library.new twice for the same movie (one per section)
        saveMediaEvent(service, "library.new", title, "Gonin added");
        saveMediaEvent(service, "library.new", title, "Gonin added again");

        const events = getRecentMediaEvents(service, 10);
        const matching = events.filter(e => e.title === title);

        // Only one should have been stored
        expect(matching.length).toBe(1);
    });

    test("should NOT deduplicate events with different titles", () => {
        service = `test_notdedup_titles_${Date.now()}_${Math.random()}`;
        const suffix = Date.now();
        const titleA = `Movie A ${suffix}`;
        const titleB = `Movie B ${suffix}`;

        saveMediaEvent(service, "library.new", titleA, "A added");
        saveMediaEvent(service, "library.new", titleB, "B added");

        const events = getRecentMediaEvents(service, 10);
        const matching = events.filter(e => e.title === titleA || e.title === titleB);

        expect(matching.length).toBe(2);
    });

    test("should NOT deduplicate events with different event types", () => {
        service = `test_notdedup_types_${Date.now()}_${Math.random()}`;
        const title = `Ran_${Date.now()}`;

        saveMediaEvent(service, "library.new", title, "added");
        saveMediaEvent(service, "media.play", title, "played");

        const events = getRecentMediaEvents(service, 10);
        const matching = events.filter(e => e.title === title);

        expect(matching.length).toBe(2);
    });
});
