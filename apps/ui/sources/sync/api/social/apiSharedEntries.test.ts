import { beforeEach, describe, expect, it, vi } from 'vitest';
const boundary = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/sync/http/client', () => ({ serverFetch: boundary.fetch }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope', () => ({
    createSessionRequestWithServerScope: ({ activeRequest }: { activeRequest: unknown }) => activeRequest,
}));
import { createSharedEntryClient, SharedEntryError } from './apiSharedEntries';

const access = { entryId: 'entry', title: 'Project', memberId: 'member', status: 'pending', sessionId: null, hostOnline: true, errorCode: null };
describe('shared entry API boundary', () => {
    beforeEach(() => boundary.fetch.mockReset());
    it('redeems the opaque invite without treating pending access as a ready conversation', async () => {
        boundary.fetch.mockResolvedValue(new Response(JSON.stringify({ access }), { status: 200 }));
        const client = createSharedEntryClient();
        expect(await client.redeem('opaque-token')).toEqual(access);
        const [path, init] = boundary.fetch.mock.calls[0];
        expect(path).toBe('/v1/shared-session-entries/redeem');
        expect(JSON.parse(init.body)).toEqual({ inviteToken: 'opaque-token' });
    });
    it('retains offline refusal as a typed error and never retries a mutation', async () => {
        boundary.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'host_offline' }), { status: 409 }));
        const error = await createSharedEntryClient().redeem('token').catch(e => e);
        expect(error).toBeInstanceOf(SharedEntryError);
        expect(error.code).toBe('host_offline');
        expect(boundary.fetch).toHaveBeenCalledTimes(1);
    });
    it('refuses a malformed ready result instead of navigating with a missing session', async () => {
        boundary.fetch.mockResolvedValue(new Response(JSON.stringify({ access: { ...access, status: 'ready' } }), { status: 200 }));
        await expect(createSharedEntryClient().redeem('token')).rejects.toThrow();
    });
    it('changes only the two-state membership permission', async () => {
        boundary.fetch.mockResolvedValue(new Response(JSON.stringify({ member: { id: 'm', userId: 'u', username: null, status: 'revoked', enabled: false, sessionId: null, errorCode: null } }), { status: 200 }));
        await createSharedEntryClient().setMemberEnabled('e', 'm', false);
        const [path, init] = boundary.fetch.mock.calls[0];
        expect(path).toBe('/v1/shared-session-entries/e/members/m');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toEqual({ enabled: false });
    });
});
