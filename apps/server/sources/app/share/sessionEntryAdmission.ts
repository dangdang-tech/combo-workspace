import { db } from "@/storage/db";
import type { Tx } from "@/storage/inTx";
import { SESSION_ENTRY_MEMBERSHIP_SELECT, sessionEntryLiveTaskRejection } from "./sessionEntryPresence";

export type SessionEntryTaskRejection = NonNullable<ReturnType<typeof sessionEntryLiveTaskRejection>>;

/** Recheck membership and live host at the write/claim owner, including inside its transaction. */
export async function resolveSessionEntryTaskRejection(params: Readonly<{
    tx?: Tx;
    actorUserId: string;
    sessionId: string;
    allowOwnerTranscript?: boolean;
}>): Promise<SessionEntryTaskRejection | null> {
    const session = await (params.tx ?? db).session.findUnique({
        where: { id: params.sessionId },
        select: { accountId: true, sharedSessionEntryMember: { select: SESSION_ENTRY_MEMBERSHIP_SELECT } },
    });
    if (!session?.sharedSessionEntryMember) return null;
    // The host must still be able to publish results and recover history while its
    // machine socket reconnects. Guests cannot claim that exception by changing a role.
    if (params.allowOwnerTranscript && session.accountId === params.actorUserId) return null;
    return sessionEntryLiveTaskRejection(session.sharedSessionEntryMember, params.actorUserId);
}
