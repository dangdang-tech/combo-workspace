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
    it.each([
        { snapshot: true, expected: true },
        { snapshot: undefined, expected: false },
    ])('preserves context readiness in list and create responses (snapshot=$snapshot)', async ({ snapshot, expected }) => {
        const entry = { id: 'entry', title: 'Project', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasContextSnapshot: snapshot };
        boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ entries: [entry] })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ entry, inviteToken: 'new-token' })));
        const client = createSharedEntryClient();
        expect((await client.list())[0].hasContextSnapshot).toBe(expected);
        expect((await client.create({ title: 'Project', sourceSessionId: 'source', machineId: 'host' })).entry.hasContextSnapshot).toBe(expected);
    });
    it('previews public details and an existing copy without placing the invite in the URL or allocating again', async () => {
        const preview = { title: 'Interview coach', description: 'Practice one question at a time', publisherDisplayName: 'Publisher' };
        boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ preview, access: { ...access, status: 'ready', sessionId: 'child' } })));
        expect(await createSharedEntryClient().preview('opaque-token')).toEqual({ preview, access: { ...access, status: 'ready', sessionId: 'child' } });
        expect(boundary.fetch.mock.calls).toEqual([['/v1/shared-session-entries/preview', expect.objectContaining({ method: 'POST', body: JSON.stringify({ inviteToken: 'opaque-token' }) })]]);
    });
    it('retains reusable-link availability and retrieves the published token without rotating it', async () => {
        const publicMetadata = { v: 1, description: 'Practice', publisherDisplayName: 'Publisher' };
        boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ entries: [{ id: 'entry', title: 'Project', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasReusableInvite: true, publicMetadata }] })))
            .mockResolvedValueOnce(new Response(JSON.stringify({ inviteToken: 'original-token' })));
        const client = createSharedEntryClient();
        expect((await client.list())[0]).toMatchObject({ hasReusableInvite: true, publicMetadata });
        expect(await client.getInvite('entry')).toBe('original-token');
        expect(boundary.fetch.mock.calls[1]).toEqual(['/v1/shared-session-entries/entry/invite', undefined]);
    });
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
