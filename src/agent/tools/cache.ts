const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_ENTRIES = 100; // LRU cache limit

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    accessCount: number;
    lastAccessed: number;
}

class LRUCache<T> {
    private cache = new Map<string, CacheEntry<T>>();
    private maxSize: number;
    private intervalId: any;

    constructor(maxSize: number = MAX_CACHE_ENTRIES) {
        this.maxSize = maxSize;
        // Set up periodic cleanup every 10 minutes
        this.intervalId = setInterval(() => this.cleanup(), 10 * 60 * 1000);
        // Ensure interval does not keep the event loop alive in test scripts
        if (this.intervalId && typeof this.intervalId.unref === 'function') {
            this.intervalId.unref();
        }
    }

    get(key: string): T | undefined {
        const entry = this.cache.get(key);
        if (!entry) return undefined;

        const now = Date.now();
        if (now - entry.timestamp > CACHE_TTL) {
            this.cache.delete(key);
            return undefined;
        }

        // Update access tracking
        entry.accessCount++;
        entry.lastAccessed = now;

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, entry);

        return entry.data;
    }

    set(key: string, data: T): void {
        const now = Date.now();

        // Remove existing entry if present
        if (this.cache.has(key)) {
            this.cache.delete(key);
        }

        // Ensure size limit
        if (this.cache.size >= this.maxSize) {
            // Remove least recently used (first entry)
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            data,
            timestamp: now,
            accessCount: 1,
            lastAccessed: now
        });
    }

    cleanup(): void {
        const now = Date.now();
        const toDelete: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > CACHE_TTL) {
                toDelete.push(key);
            }
        }

        toDelete.forEach(key => this.cache.delete(key));

        if (toDelete.length > 0) {
            console.log(`🧹 Cache cleanup: removed ${toDelete.length} expired entries`);
        }
    }

    clear(): void {
        this.cache.clear();
    }

    size(): number {
        return this.cache.size;
    }
}

export const configCache = new LRUCache<any>();

export function clearCache(): void {
    configCache.clear();
}

export function invalidateCachePattern(pattern: string): void {
    configCache.clear();
}

export async function withCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
    const cached = configCache.get(key);
    if (cached) {
        return cached;
    }
    const data = await fetcher();
    configCache.set(key, data);
    return data;
}
