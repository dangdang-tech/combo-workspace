import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storage';

const { mockSessionRpcWithPreferredSessionScope } = vi.hoisted(() => ({
    mockSessionRpcWithPreferredSessionScope: vi.fn(),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/sessionRpcWithPreferredSessionScope', () => ({
    sessionRpcWithPreferredSessionScope: (...args: unknown[]) => mockSessionRpcWithPreferredSessionScope(...args),
}));

// sessions.ts imports sync, which pulls native modules in node/vitest.
vi.mock('../sync', () => ({
    sync: {
        encryption: {
            getSessionEncryption: () => null,
            getMachineEncryption: () => null,
        },
    },
}));

import { createPermissionActionDispatchGuard } from '@/components/tools/shell/permissions/permissionActionDispatchGuard';
import { sessionAllow, sessionAllowWithAnswers, sessionAllowWithPermissionUpdates, sessionDeny } from './sessions';

const initialStorageState = storage.getState();

function buildSession(sessionId: string): Session {
    return {
        id: sessionId,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: true,
        thinkingAt: 1,
        presence: 'online',
    };
}

describe('sessionDeny', () => {
    beforeEach(() => {
        storage.setState(initialStorageState, true);
        mockSessionRpcWithPreferredSessionScope.mockReset();
    });

    it('clears local thinking state after a deny/abort permission decision', async () => {
        const sessionId = 's_permission_deny';
        storage.getState().applySessions([buildSession(sessionId)]);
        storage.getState().markSessionOptimisticThinking(sessionId);
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue(undefined);

        await sessionDeny(sessionId, 'perm_1', undefined, undefined, 'abort');

        const session = storage.getState().sessions[sessionId];
        expect(session?.thinking).toBe(false);
        expect(session?.optimisticThinkingAt ?? null).toBeNull();
        expect(typeof session?.thinkingGraceUntil).toBe('number');
        expect(mockSessionRpcWithPreferredSessionScope).toHaveBeenCalledWith({
            sessionId,
            method: 'permission',
            payload: expect.objectContaining({ id: 'perm_1', approved: false, decision: 'abort' }),
        });
    });

    it.each([
        ['allow', () => sessionAllow('s_permission_response', 'perm_1')],
        ['allow with updates', () => sessionAllowWithPermissionUpdates('s_permission_response', 'perm_1', { updatedPermissions: [] })],
        ['allow with legacy answers', () => sessionAllowWithAnswers('s_permission_response', 'perm_1', { protocol: 'legacy-permission', answers: { Question: 'Answer' } })],
        ['deny', () => sessionDeny('s_permission_response', 'perm_1')],
    ] as const)('rejects a decrypted application failure for %s', async (_name, decide) => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue({
            ok: false,
            errorCode: 'permission_request_not_found',
            errorMessage: 'This permission request is no longer available',
            requestId: 'perm_1',
        });

        await expect(decide()).rejects.toMatchObject({
            message: 'This permission request is no longer available',
            rpcErrorCode: 'permission_request_not_found',
        });
    });

    it('preserves thinking and allows the same permission to be retried after an application failure', async () => {
        const sessionId = 's_permission_retry';
        storage.getState().applySessions([buildSession(sessionId)]);
        storage.getState().markSessionOptimisticThinking(sessionId);
        const requestKey = `${sessionId}\u0000perm_1`;
        const guard = createPermissionActionDispatchGuard(requestKey);
        guard.retainRequest(requestKey);
        mockSessionRpcWithPreferredSessionScope
            .mockResolvedValueOnce({ ok: false, errorCode: 'permission_response_failed', errorMessage: 'Try again' })
            .mockResolvedValueOnce({ ok: true });

        try {
            await expect(guard.dispatch(requestKey, () => sessionDeny(sessionId, 'perm_1'))).rejects.toThrow('Try again');
            expect(storage.getState().sessions[sessionId]?.thinking).toBe(true);
            expect(storage.getState().sessions[sessionId]?.optimisticThinkingAt).not.toBeNull();
            await expect(guard.dispatch(requestKey, () => sessionDeny(sessionId, 'perm_1'))).resolves.toBe(true);
            expect(mockSessionRpcWithPreferredSessionScope).toHaveBeenCalledTimes(2);
            expect(storage.getState().sessions[sessionId]?.thinking).toBe(false);
        } finally {
            guard.releaseRequest(requestKey);
        }
    });

    it('rejects a decrypted RPC handler error instead of treating it as a successful permission response', async () => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue({ error: 'Invalid RPC params' });
        await expect(sessionDeny('s_permission_error', 'perm_1')).rejects.toThrow('Invalid RPC params');
    });

    it.each([undefined, null, { ok: true }])('accepts a successful or legacy void acknowledgement: %j', async (result) => {
        mockSessionRpcWithPreferredSessionScope.mockResolvedValue(result);
        await expect(sessionAllow('s_permission_success', 'perm_1')).resolves.toBeUndefined();
    });
});
