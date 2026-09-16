import { resolvePresenceTimeoutConfig } from "@/app/presence/presenceTimeoutConfig";

export interface SessionEntryMachinePresence {
    id: string;
    accountId: string;
    active: boolean;
    lastActiveAt: Date;
    revokedAt: Date | null;
    replacedByMachineId: string | null;
}

export interface SessionEntryMembership {
    userId: string;
    enabled: boolean;
    status: string;
    entry: { ownerId: string; machine: SessionEntryMachinePresence };
}

export function isSessionEntryHostOnline(machine: SessionEntryMachinePresence, now = Date.now()): boolean {
    return machine.active && !machine.revokedAt && !machine.replacedByMachineId
        && machine.lastActiveAt.getTime() > now - resolvePresenceTimeoutConfig().machineTimeoutMs;
}

export function sessionEntryTaskRejection(
    member: SessionEntryMembership | null | undefined,
    actorUserId: string,
    now = Date.now(),
): "forbidden" | "shared_session_access_revoked" | "host_offline" | null {
    if (!member) return null;
    if (actorUserId !== member.userId && actorUserId !== member.entry.ownerId) return "forbidden";
    if (!member.enabled || member.status !== "ready") return "shared_session_access_revoked";
    return isSessionEntryHostOnline(member.entry.machine, now) ? null : "host_offline";
}
