import { beforeEach, describe, expect, it } from 'vitest';

import { storage } from '@/sync/domains/state/storage';
import { loadPendingOutboxForSession } from '@/sync/domains/state/pendingOutboxPersistence';
import { getSessionDraftSnapshot, writeExistingSessionDraft } from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { enqueuePendingMessageV2, replayPersistedPendingOutboxForSession, retryPendingOutboxOperationV2 } from './pendingQueueV2';
import { buildSession, createPendingQueueEncryption, resetPendingQueueState } from './pendingQueueV2.testHelpers';

const outboxScope = { serverId: 'shared-admission-server', accountId: 'shared-admission-account' };
const refusals = [
    { status: 409, code: 'host_offline' },
    { status: 403, code: 'shared_session_access_revoked' },
] as const;

function draftText(sessionId: string): string | null {
    return getSessionDraftSnapshot(outboxScope, { kind: 'session', sessionId })?.document.composer.text.value ?? null;
}

describe('shared-session task admission refusal', () => {
    beforeEach(() => resetPendingQueueState());

    it.each(refusals)('retires initial $code rejection and exposes its code without invalidating account auth', async ({ status, code }) => {
        const sessionId = `initial-${code}`;
        storage.getState().applySessions([buildSession({ sessionId })]);
        await expect(enqueuePendingMessageV2({
            sessionId, text: 'keep my question', localId: 'initial-local',
            encryption: await createPendingQueueEncryption({ sessionId }), outboxScope,
            requestedAction: { v: 1, kind: 'enqueue' }, wireMode: 'pending_input_v1',
            request: async () => Response.json({ error: code }, { status }),
        })).rejects.toMatchObject({ code });
        expect(await loadPendingOutboxForSession(sessionId, outboxScope)).toEqual([]);
        expect(storage.getState().sessionPending[sessionId]?.messages ?? []).toEqual([]);
        expect(await replayPersistedPendingOutboxForSession(sessionId, outboxScope)).toEqual([]);
    });

    it.each(refusals)('restores a refused retry to a draft and never replays $code after reconnect', async ({ status, code }) => {
        const sessionId = `retry-${code}`;
        storage.getState().applySessions([buildSession({ sessionId })]);
        const initial = await enqueuePendingMessageV2({
            sessionId, text: 'keep my earlier question', localId: 'retry-local',
            encryption: await createPendingQueueEncryption({ sessionId }), outboxScope,
            requestedAction: { v: 1, kind: 'enqueue' }, wireMode: 'pending_input_v1',
            request: async () => { throw new TypeError('Failed to fetch'); },
        });
        expect(initial.accepted).toBe(false);
        writeExistingSessionDraft({ scope: outboxScope, sessionId, patch: { text: 'a newer draft' } });

        await expect(retryPendingOutboxOperationV2({
            sessionId, localId: initial.localId, outboxScope, wireMode: 'pending_input_v1',
            request: async () => Response.json({ error: code }, { status }),
        })).rejects.toMatchObject({ code });

        expect(draftText(sessionId)).toBe('a newer draft\n\nkeep my earlier question');
        expect(await loadPendingOutboxForSession(sessionId, outboxScope)).toEqual([]);
        expect(storage.getState().sessionPending[sessionId]?.messages ?? []).toEqual([]);
        expect(await replayPersistedPendingOutboxForSession(sessionId, outboxScope)).toEqual([]);
        let replayRequests = 0;
        await retryPendingOutboxOperationV2({
            sessionId, localId: initial.localId, outboxScope, wireMode: 'pending_input_v1',
            request: async () => { replayRequests += 1; return Response.json({}); },
        });
        expect(replayRequests).toBe(0);
        expect(draftText(sessionId)).toBe('a newer draft\n\nkeep my earlier question');
    });
});
