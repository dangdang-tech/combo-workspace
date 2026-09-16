import { eventRouter } from "@/app/events/eventRouter";
import { isSessionEntryHostOnline, sessionEntryTaskRejection, type SessionEntryMachinePresence, type SessionEntryMembership } from "./sessionEntryPolicy";

export const SESSION_ENTRY_MACHINE_SELECT = {
    id: true, accountId: true, active: true, lastActiveAt: true, revokedAt: true, replacedByMachineId: true,
} as const;

export const SESSION_ENTRY_MEMBERSHIP_SELECT = {
    userId: true, enabled: true, status: true,
    entry: { select: { ownerId: true, machine: { select: SESSION_ENTRY_MACHINE_SELECT } } },
} as const;

// MVP runs on one relay. A recent database heartbeat alone must not admit work
// after a disconnect; the exact host must still have a live machine socket.
export function isSessionEntryHostLive(machine: SessionEntryMachinePresence, now = Date.now()): boolean {
    if (!isSessionEntryHostOnline(machine, now)) return false;
    return [...(eventRouter.getConnections(machine.accountId) ?? [])].some((connection) =>
        connection.connectionType === "machine-scoped"
        && connection.machineId === machine.id && connection.socket.connected);
}

export function sessionEntryLiveTaskRejection(member: SessionEntryMembership | null | undefined, actorUserId: string) {
    const rejection = sessionEntryTaskRejection(member, actorUserId);
    if (rejection || !member) return rejection;
    return isSessionEntryHostLive(member.entry.machine) ? null : "host_offline";
}
