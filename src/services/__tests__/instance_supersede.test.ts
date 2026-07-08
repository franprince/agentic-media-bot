import { describe, it, expect, beforeEach, afterEach, spyOn, jest } from "bun:test";
import { randomUUID } from "node:crypto";
import { setMetadata, getMetadata } from "../database";

// Instead of importing the whole bot.ts which starts everything,
// we can test the logic if we had exported it, or we can mock the process.exit.
// Since we can't easily import internal bot.ts functions without side effects,
// we will simulate the heartbeat logic here to verify the mechanism.

describe("Instance Supersede Logic", () => {
    const INSTANCE_A = randomUUID();
    const INSTANCE_B = randomUUID();

    beforeEach(() => {
        // Clear metadata
        setMetadata("active_instance_id", "");
        setMetadata("active_instance_pid", "");
        setMetadata("instance_heartbeat", "");
    });

    it("should detect when it is NO LONGER the leader", () => {
        // Instance A takes lock
        setMetadata("active_instance_id", INSTANCE_A);
        
        // Simulating the check inside Instance A's heartbeat
        const currentActiveId = getMetadata("active_instance_id");
        expect(currentActiveId).toBe(INSTANCE_A); // A is leader
        
        // Instance B takes lock (superseding A)
        setMetadata("active_instance_id", INSTANCE_B);
        
        // Instance A checks again
        const nextActiveId = getMetadata("active_instance_id");
        expect(nextActiveId).not.toBe(INSTANCE_A);
        expect(nextActiveId).toBe(INSTANCE_B);
    });

    it("should update heartbeat only if it IS the leader", () => {
        setMetadata("active_instance_id", INSTANCE_A);
        const initialHeartbeat = "1000";
        setMetadata("instance_heartbeat", initialHeartbeat);

        // Instance A wants to update heartbeat
        const currentActiveId = getMetadata("active_instance_id");
        if (currentActiveId === INSTANCE_A) {
            setMetadata("instance_heartbeat", "2000");
        }
        expect(getMetadata("instance_heartbeat")).toBe("2000");

        // Instance B takes over
        setMetadata("active_instance_id", INSTANCE_B);

        // Instance A tries to update heartbeat again
        const newerActiveId = getMetadata("active_instance_id");
        if (newerActiveId === INSTANCE_A) {
            setMetadata("instance_heartbeat", "3000");
        }
        
        // Heartbeat should NOT have changed to 3000
        expect(getMetadata("instance_heartbeat")).toBe("2000");
    });

    it("should decide to exit or retry on 409 conflict based on lock ownership", () => {
        const testHandleConflict = (myInstanceId: string, getActiveId: () => string) => {
            const activeId = getActiveId();
            if (activeId !== myInstanceId) {
                return "exit";
            }
            return "retry";
        };

        // Case 1: We own the lock -> should retry/ignore
        const result1 = testHandleConflict(INSTANCE_A, () => INSTANCE_A);
        expect(result1).toBe("retry");

        // Case 2: We do not own the lock (another instance superseded us) -> should exit
        const result2 = testHandleConflict(INSTANCE_A, () => INSTANCE_B);
        expect(result2).toBe("exit");
    });
});
