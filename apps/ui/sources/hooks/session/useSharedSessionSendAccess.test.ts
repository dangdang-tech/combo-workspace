import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@/dev/testkit';
const boundary = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/sync/http/client', () => ({ serverFetch: boundary.fetch }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope', () => ({ createSessionRequestWithServerScope: ({ activeRequest }: { activeRequest: unknown }) => activeRequest }));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('react-native', async () => { const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative'); return createReactNativeWebMock(); });
vi.mock('@/text', async () => { const { createTextModuleMock } = await import('@/dev/testkit/mocks/text'); return createTextModuleMock(); });
const access = { entryId: 'e', title: 'Project', memberId: 'm', status: 'ready', sessionId: 'child', hostOnline: false, errorCode: null };
describe('shared session send access', () => {
    beforeEach(() => boundary.fetch.mockReset());
    it('blocks offline and allows a later explicit retry after online without sending any message', async () => {
        boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access }), { status: 200 }));
        const { useSharedSessionSendAccess } = await import('./useSharedSessionSendAccess');
        const hook = await renderHook(() => useSharedSessionSendAccess('child', 'relay', true));
        expect(hook.getCurrent().blocked).toBe(true);
        expect(hook.getCurrent().message).toBe('sharedEntry.hostOffline');
        boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access: { ...access, hostOnline: true } }), { status: 200 }));
        await act(async () => { expect(await hook.getCurrent().refresh()).toBe(true); });
        expect(hook.getCurrent().blocked).toBe(false);
        expect(boundary.fetch.mock.calls.every(([path, init]) => path.endsWith('/shared-session-entry-access') && !init?.method)).toBe(true);
    });
    it('fails closed after access revocation, even with an earlier ready snapshot', async () => {
        boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access: { ...access, hostOnline: true } }), { status: 200 }));
        const { useSharedSessionSendAccess } = await import('./useSharedSessionSendAccess');
        const hook = await renderHook(() => useSharedSessionSendAccess('child', 'relay', true));
        expect(hook.getCurrent().blocked).toBe(false);
        boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }));
        await act(async () => { expect(await hook.getCurrent().refresh()).toBe(false); });
        expect(hook.getCurrent().blocked).toBe(true);
    });
    it('leaves ordinary sessions on their existing submission path', async () => {
        const { useSharedSessionSendAccess } = await import('./useSharedSessionSendAccess');
        const hook = await renderHook(() => useSharedSessionSendAccess('ordinary', 'relay', false));
        expect(hook.getCurrent().blocked).toBe(false);
        expect(boundary.fetch).not.toHaveBeenCalled();
    });
    it('blocks while checking the same session id on a different server', async () => {
        boundary.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ access: { ...access, hostOnline: true } }), { status: 200 }));
        const { useSharedSessionSendAccess } = await import('./useSharedSessionSendAccess');
        const hook = await renderHook((serverId: string) => useSharedSessionSendAccess('child', serverId, true), { initialProps: 'relay-a' });
        expect(hook.getCurrent().blocked).toBe(false);
        let resolveAccess!: (response: Response) => void;
        boundary.fetch.mockReturnValueOnce(new Promise<Response>(resolve => { resolveAccess = resolve; }));
        await hook.rerender('relay-b');
        expect(hook.getCurrent().blocked).toBe(true);
        expect(hook.getCurrent().message).toBe('sharedEntry.checking');
        await act(async () => { resolveAccess(new Response(JSON.stringify({ access }), { status: 200 })); });
        expect(hook.getCurrent().message).toBe('sharedEntry.hostOffline');
    });
});
