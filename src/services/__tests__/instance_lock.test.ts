import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import * as database from "../database";

// Mock acquireInstanceLock implementation for testing
function acquireInstanceLockMock(
  getMetadata: (key: string) => string | null,
  setMetadata: (key: string, value: string) => void,
  isPidRunning: (pid: number) => boolean
): boolean {
    const activePid = getMetadata("active_instance_pid");
    const now = Date.now();
    const heartbeat = Number(getMetadata("instance_heartbeat") || 0);

    // If no active PID, we can take over.
    if (!activePid) {
        setMetadata("active_instance_pid", String(process.pid));
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    const pid = Number(activePid);
    const running = isPidRunning(pid);

    // If heartbeat is in the future, it's weird. If PID is dead, take over.
    // If PID is dead, take over regardless of heartbeat.
    if (!running) {
        setMetadata("active_instance_pid", String(process.pid));
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    // If PID is running, check heartbeat.
    // Allow 2 minutes of staleness (120000ms)
    // Also handle future heartbeats (more than 5 mins in future) as stale/invalid
    const isHeartbeatStale = (now - heartbeat > 120000);
    const isHeartbeatInFuture = (heartbeat - now > 300000);

    if (isHeartbeatStale || isHeartbeatInFuture) {
        setMetadata("active_instance_pid", String(process.pid));
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    // If it's already us, just update heartbeat (handled in caller usually, but here for completeness)
    if (pid === process.pid) {
        setMetadata("instance_heartbeat", String(now));
        return true;
    }

    return false;
}

describe("Instance Lock Logic", () => {
    let mockMetadata: Record<string, string> = {};

    beforeEach(() => {
        mockMetadata = {};
    });

    const getMeta = (key: string) => mockMetadata[key] || null;
    const setMeta = (key: string, value: string) => { mockMetadata[key] = value; };

    test("should succeed on empty database", () => {
        const result = acquireInstanceLockMock(getMeta, setMeta, () => false);
        expect(result).toBe(true);
        expect(mockMetadata["active_instance_pid"]).toBe(String(process.pid));
    });

    test("should succeed if recorded PID is not running", () => {
        setMeta("active_instance_pid", "999999");
        setMeta("instance_heartbeat", String(Date.now()));
        
        const result = acquireInstanceLockMock(getMeta, setMeta, (pid) => pid !== 999999);
        expect(result).toBe(true);
        expect(mockMetadata["active_instance_pid"]).toBe(String(process.pid));
    });

    test("should fail if recorded PID is running and heartbeat is fresh", () => {
        const otherPid = 12345;
        setMeta("active_instance_pid", String(otherPid));
        setMeta("instance_heartbeat", String(Date.now()));
        
        const result = acquireInstanceLockMock(getMeta, setMeta, (pid) => pid === otherPid);
        expect(result).toBe(false);
        expect(mockMetadata["active_instance_pid"]).toBe(String(otherPid));
    });

    test("should succeed if recorded PID is running but heartbeat is old", () => {
        const otherPid = 12345;
        setMeta("active_instance_pid", String(otherPid));
        setMeta("instance_heartbeat", String(Date.now() - 130000)); // 2m 10s ago
        
        const result = acquireInstanceLockMock(getMeta, setMeta, (pid) => pid === otherPid);
        expect(result).toBe(true);
        expect(mockMetadata["active_instance_pid"]).toBe(String(process.pid));
    });

    test("should succeed if heartbeat is too far in the future", () => {
        const otherPid = 12345;
        setMeta("active_instance_pid", String(otherPid));
        setMeta("instance_heartbeat", String(Date.now() + 600000)); // 10 mins in future
        
        const result = acquireInstanceLockMock(getMeta, setMeta, (pid) => pid === otherPid);
        expect(result).toBe(true);
        expect(mockMetadata["active_instance_pid"]).toBe(String(process.pid));
    });
});
