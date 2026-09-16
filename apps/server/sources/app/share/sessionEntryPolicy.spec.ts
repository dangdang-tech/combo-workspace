import { describe, expect, it } from "vitest";
import { isSessionEntryHostOnline, sessionEntryTaskRejection, type SessionEntryMembership } from "./sessionEntryPolicy";

const now = 1_000_000;
function member(): SessionEntryMembership {
    return {
        userId: "guest-a", enabled: true, status: "ready",
        entry: {
            ownerId: "host",
            machine: { id: "machine", accountId: "host", active: true, lastActiveAt: new Date(now), revokedAt: null, replacedByMachineId: null },
        },
    };
}

describe("shared entry task admission", () => {
    it("keeps ordinary sessions unchanged and accepts only the assigned member or host", () => {
        expect(sessionEntryTaskRejection(null, "ordinary", now)).toBeNull();
        expect(sessionEntryTaskRejection(member(), "guest-a", now)).toBeNull();
        expect(sessionEntryTaskRejection(member(), "host", now)).toBeNull();
        expect(sessionEntryTaskRejection(member(), "guest-b", now)).toBe("forbidden");
    });

    it("rejects disabled and unprovisioned member sessions even when the machine is online", () => {
        expect(sessionEntryTaskRejection({ ...member(), enabled: false }, "guest-a", now)).toBe("shared_session_access_revoked");
        expect(sessionEntryTaskRejection({ ...member(), status: "provisioning" }, "guest-a", now)).toBe("shared_session_access_revoked");
    });

    it.each([
        { active: false },
        { lastActiveAt: new Date(0) },
        { revokedAt: new Date(now) },
        { replacedByMachineId: "replacement" },
    ])("rejects tasks for unavailable machines: %j", (change) => {
        const value = member();
        value.entry.machine = { ...value.entry.machine, ...change };
        expect(isSessionEntryHostOnline(value.entry.machine, now)).toBe(false);
        expect(sessionEntryTaskRejection(value, "guest-a", now)).toBe("host_offline");
    });
});
