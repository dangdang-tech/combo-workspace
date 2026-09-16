import { db } from "@/storage/db";
import type { Tx } from "@/storage/inTx";

export async function getSessionParticipantUserIds(params: {
    sessionId: string;
    tx?: Tx;
}): Promise<string[]> {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    if (!sessionId) return [];

    const client = params.tx ?? db;
    const session = await client.session.findUnique({
        where: { id: sessionId },
        select: {
            accountId: true,
            sharedSessionEntryMember: { select: { userId: true, enabled: true, status: true } },
            shares: {
                select: {
                    sharedWithUserId: true,
                },
            },
        },
    });

    if (!session) {
        return [];
    }

    const ids = new Set<string>();
    ids.add(session.accountId);
    const entryMember = session.sharedSessionEntryMember;
    for (const share of session.shares) {
        // Live payload fan-out must enforce the same private-child boundary as
        // reads, including when an older share writer leaves an unrelated grant.
        if (entryMember && (!entryMember.enabled || entryMember.status !== 'ready'
            || share.sharedWithUserId !== entryMember.userId)) continue;
        ids.add(share.sharedWithUserId);
    }
    return Array.from(ids);
}
