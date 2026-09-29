import React from 'react';
import { RPC_ERROR_CODES } from '@happier-dev/protocol/rpc';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, renderScreen } from '@/dev/testkit';

const boundary = vi.hoisted(() => ({
    alert: vi.fn(), rpc: vi.fn(), copy: vi.fn(), push: vi.fn(), token: 'account-a',
    server: { serverId: 'server-a', serverUrl: 'https://relay.example', generation: 1 },
    machines: [] as Array<{ id: string; active: boolean; metadata: { displayName: string; homeDir?: string } }>,
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({ machineRpcWithServerScope: boundary.rpc }));
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: Boolean(boundary.token), credentials: { token: boundary.token } }) }));
vi.mock('@/sync/domains/server/serverRuntime', () => ({ getActiveServerSnapshot: () => boundary.server, subscribeActiveServer: () => () => {} }));
vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({ useAllMachines: () => boundary.machines, storage: { getState: () => ({ machines: Object.fromEntries(boundary.machines.map(machine => [machine.id, machine])) }) } });
});
vi.mock('@/sync/store/hooks', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({ useLocalSetting: (key: string) => key === 'uiFontScale' ? 1 : 'comfortable' });
});
vi.mock('expo-router', async () => { const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router'); return createExpoRouterMock({ router: { push: boundary.push } }).module; });
vi.mock('react-native', async () => { const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative'); return createReactNativeWebMock(); });
vi.mock('react-native-unistyles', async () => { const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles'); return createUnistylesMock(); });
vi.mock('@/text', async () => { const { createTextModuleMock } = await import('@/dev/testkit/mocks/text'); return createTextModuleMock({ translate: (key) => key }); });
vi.mock('@/modal', async () => { const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal'); return createModalModuleMock({ spies: { alert: boundary.alert } }).module; });
vi.mock('expo-clipboard', () => ({ setStringAsync: boundary.copy }));
vi.mock('@/components/ui/lists/Item', () => ({ Item: (props: any) => React.createElement('Item', props) }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: (props: any) => React.createElement('ItemGroup', props, props.title, props.children) }));
vi.mock('@/components/ui/lists/ItemList', () => ({ ItemList: (props: any) => React.createElement('ItemList', props, props.children) }));
vi.mock('@/components/ui/status/StatusDot', () => ({ StatusDot: 'StatusDot' }));

const candidate = { remoteSessionId: 'native-thread', title: 'Interview practice', updatedAtMs: 1, details: { cwd: '/home/owner/project' } };
const fingerprint = 'a'.repeat(64);
const ready = { ok: true, status: 'ready', snapshotFingerprint: fingerprint, directory: '/home/owner/project', messages: [{ role: 'user', text: 'Practice with me' }, { role: 'assistant', text: 'What did you learn?' }] };
const publication = { sourceSessionId: 'source', entryId: 'entry', inviteUrl: 'https://web.example/invite/token?server=https%3A%2F%2Frelay.example' };
const calls = (method: string) => boundary.rpc.mock.calls.filter(([request]) => request.method === method);
const previewMethod = 'daemon.directSessions.publish.preview';
const publishMethod = 'daemon.directSessions.publish';

async function openPreview() {
    const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
    const screen = await renderScreen(<NativeSessionPublishScreen />);
    await act(async () => { screen.pressByTestId('direct-session-directory-toggle:/home/owner/project'); });
    await act(async () => { screen.pressByTestId('direct-session-candidate:native-thread'); });
    return screen;
}

describe('NativeSessionPublishScreen', () => {
    beforeEach(() => {
        vi.clearAllMocks(); boundary.token = 'account-a';
        boundary.server = { serverId: 'server-a', serverUrl: 'https://relay.example', generation: 1 };
        boundary.machines = [{ id: 'machine-a', active: true, metadata: { displayName: 'My Mac', homeDir: '/home/owner' } }];
        boundary.copy.mockResolvedValue(true);
        boundary.rpc.mockReset().mockImplementation(async ({ method }) => {
            if (method === 'daemon.directSessions.candidates.list') return { ok: true, candidates: [candidate], nextCursor: null };
            if (method === previewMethod) return ready;
            if (method === publishMethod) return { ok: true, publication };
            throw new Error('Unexpected RPC');
        });
    });

    it('only shows running activity in the share picker while idle conversations remain selectable', async () => {
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? ready : {
            ok: true, candidates: ['idle', 'active_recently', 'unknown', 'running'].map(activity => ({
                ...candidate, remoteSessionId: activity, activity,
            })), nextCursor: null,
        });
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        await act(async () => { screen.pressByTestId('direct-session-view:recent'); });
        for (const activity of ['idle', 'active_recently', 'unknown']) {
            expect(screen.findByTestId(`direct-session-candidate:${activity}`)?.props.rightElement).toBeNull();
        }
        expect(React.isValidElement(screen.findByTestId('direct-session-candidate:running')?.props.rightElement)).toBe(true);
        await act(async () => { screen.pressByTestId('direct-session-candidate:idle'); });
        expect(screen.findByTestId('native-publish-step-2')?.props['aria-current']).toBe('step');
    });

    it('refreshes native conversations while keeping the expanded project visible', async () => {
        boundary.rpc.mockResolvedValue({ ok: true, candidates: [candidate], nextCursor: 'old-page' });
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        await act(async () => { screen.pressByTestId('direct-session-directory-toggle:/home/owner/project'); });
        const pending = createDeferred<unknown>();
        boundary.rpc.mockImplementation(async () => pending.promise);
        await act(async () => { screen.pressByTestId('direct-session-candidates-refresh'); });
        expect(screen.findByTestId('direct-session-candidate:native-thread')).not.toBeNull();
        expect(screen.findByTestId('direct-session-candidates-refresh')?.props.disabled).toBe(true);
        const requestsBeforeLoadMore = boundary.rpc.mock.calls.length;
        await act(async () => { screen.pressByTestId('direct-session-candidates-load-more'); });
        expect(boundary.rpc.mock.calls).toHaveLength(requestsBeforeLoadMore);
        expect(screen.findByTestId('direct-session-candidates-load-more')?.props.disabled).toBe(true);
        await act(async () => { pending.resolve({ ok: true, candidates: [candidate, { ...candidate, remoteSessionId: 'new-native-thread' }], nextCursor: null }); });
        expect(screen.findByTestId('direct-session-candidate:new-native-thread')).not.toBeNull();
        expect(screen.findByTestId('direct-session-candidates-refresh')?.props.disabled).toBe(false);
    });

    it('groups native conversations by full directory and preserves recent order, missing paths and page selection', async () => {
        const items = [
            { ...candidate, remoteSessionId: 'b-new', updatedAtMs: 30, details: { cwd: '/work/two/shared' } },
            { ...candidate, remoteSessionId: 'a-new', updatedAtMs: 20, details: { cwd: '/work/one/shared' } },
            { ...candidate, remoteSessionId: 'a-old', updatedAtMs: 10, details: { cwd: '/work/one/shared' } },
            { ...candidate, remoteSessionId: 'no-directory', updatedAtMs: 5, details: {} },
        ];
        boundary.rpc.mockImplementation(async ({ method, payload }) => method === previewMethod ? ready
            : { ok: true, candidates: payload.cursor ? [{ ...candidate, remoteSessionId: 'a-older', updatedAtMs: 1, details: { cwd: '/work/one/shared' } }] : items, nextCursor: payload.cursor ? null : 'older' });
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        const directoryGroups = () => screen.findAllByType('View').filter(node => String(node.props.testID ?? '').startsWith('direct-session-directory:'));
        expect(directoryGroups().map(node => node.props.testID)).toEqual([
            'direct-session-directory:/work/two/shared', 'direct-session-directory:/work/one/shared', 'direct-session-directory:unassigned',
        ]);
        expect(screen.findByTestId('direct-session-candidate:a-new')).toBeNull();
        await act(async () => { screen.pressByTestId('direct-session-directory-toggle:/work/one/shared'); });
        const group = screen.findByTestId('direct-session-directory:/work/one/shared');
        expect(group?.findAllByType('Item').filter(node => String(node.props.testID).startsWith('direct-session-candidate:')).map(node => node.props.testID)).toEqual(['direct-session-candidate:a-new', 'direct-session-candidate:a-old']);
        expect(screen.findByTestId('direct-session-directory-toggle:/work/one/shared')?.props.subtitle).toBe('/work/one/shared');
        expect(screen.findByTestId('direct-session-directory-toggle:/work/two/shared')?.props.subtitle).toBe('/work/two/shared');
        await act(async () => { screen.pressByTestId('direct-session-candidates-load-more'); });
        expect(screen.findByTestId('direct-session-directory:/work/one/shared')?.findAllByType('Item').filter(node => String(node.props.testID).startsWith('direct-session-candidate:')).map(node => node.props.testID)).toEqual([
            'direct-session-candidate:a-new', 'direct-session-candidate:a-old', 'direct-session-candidate:a-older',
        ]);
        expect(screen.findByTestId('direct-session-candidate:no-directory')).toBeNull();
        await act(async () => { screen.pressByTestId('direct-session-directory-toggle:unassigned'); });
        expect(screen.findByTestId('direct-session-candidate:no-directory')).not.toBeNull();
        await act(async () => { screen.pressByTestId('direct-session-candidate:a-older'); });
        expect(calls(previewMethod).at(-1)?.[0].payload.remoteSessionId).toBe('a-older');
    });

    it('keeps separator and trailing-slash variants of the same directory together', async () => {
        boundary.rpc.mockResolvedValue({ ok: true, candidates: [
            { ...candidate, remoteSessionId: 'windows-new', updatedAtMs: 30, details: { cwd: 'C:\\work\\shared' } },
            { ...candidate, remoteSessionId: 'windows-old', updatedAtMs: 20, details: { cwd: 'C:/work/shared/' } },
        ], nextCursor: null });
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        const groups = screen.findAllByType('View').filter(node => String(node.props.testID ?? '').startsWith('direct-session-directory:'));
        expect(groups).toHaveLength(1);
        expect(groups[0].props.testID).toBe('direct-session-directory:C:/work/shared');
        await act(async () => { screen.pressByTestId('direct-session-directory-toggle:C:/work/shared'); });
        expect(groups[0].findAllByType('Item').filter(node => String(node.props.testID).startsWith('direct-session-candidate:')).map(node => node.props.testID)).toEqual([
            'direct-session-candidate:windows-new', 'direct-session-candidate:windows-old',
        ]);
        expect(screen.findByTestId('direct-session-directory-toggle:C:/work/shared')?.props.subtitle).toBe('C:/work/shared');
    });

    it('regroups search results without retaining old projects and keeps directory-path fallback', async () => {
        boundary.rpc.mockImplementation(async ({ payload }) => ({ ok: true, candidates: payload.searchTerm
            ? [{ ...candidate, remoteSessionId: 'search-match', details: { path: 'C:\\work\\other' } }]
            : [candidate], nextCursor: null }));
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        expect(screen.findByTestId('direct-session-directory:/home/owner/project')).not.toBeNull();
        vi.useFakeTimers();
        try {
            await act(async () => { screen.findByTestId('direct-session-candidates-search-input')?.props.onChangeText('other'); });
            await act(async () => { await vi.advanceTimersByTimeAsync(300); });
            expect(screen.findByTestId('direct-session-directory:/home/owner/project')).toBeNull();
            expect(screen.findByTestId('direct-session-directory:C:/work/other')).not.toBeNull();
            expect(screen.findByTestId('direct-session-candidate:search-match')).toBeNull();
            await act(async () => { screen.pressByTestId('direct-session-directory-toggle:C:/work/other'); });
            expect(screen.findByTestId('direct-session-candidate:search-match')).not.toBeNull();
            expect(screen.findByTestId('direct-session-directory-toggle:C:/work/other')?.props.subtitle).toBe('C:/work/other');
        } finally { vi.useRealTimers(); }
    });

    it('switches between collapsed projects and recent sessions while retaining search and project expansion', async () => {
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? ready : {
            ok: true, candidates: [{ ...candidate, remoteSessionId: 'newest', updatedAtMs: 3 },
                { ...candidate, remoteSessionId: 'middle', updatedAtMs: 2, details: { cwd: '/other/project' } },
                { ...candidate, remoteSessionId: 'oldest', updatedAtMs: 1 }], nextCursor: null,
        });
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        expect(screen.findByTestId('direct-session-directory-toggle:/home/owner/project')?.props.accessibilityState).toEqual({ expanded: false });
        expect(screen.findByTestId('direct-session-candidate:newest')).toBeNull();
        await act(async () => { screen.pressByTestId('direct-session-directory-toggle:/home/owner/project'); });
        await act(async () => { screen.pressByTestId('direct-session-view:recent'); });
        expect(screen.findAllByType('Item').filter(node => String(node.props.testID).startsWith('direct-session-candidate:')).map(node => node.props.testID)).toEqual([
            'direct-session-candidate:newest', 'direct-session-candidate:middle', 'direct-session-candidate:oldest',
        ]);
        expect(screen.findByTestId('direct-session-directory:/home/owner/project')).toBeNull();
        await act(async () => { screen.findByTestId('direct-session-candidates-search-input')?.props.onChangeText('project'); });
        await act(async () => { screen.pressByTestId('direct-session-view:projects'); });
        expect(screen.findByTestId('direct-session-candidates-search-input')?.props.value).toBe('project');
        expect(screen.findByTestId('direct-session-directory-toggle:/home/owner/project')?.props.accessibilityState).toEqual({ expanded: true });
        expect(screen.findByTestId('direct-session-candidate:middle')).toBeNull();
    });

    it('reflects selection, review, publication and return in the step indicator', async () => {
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        expect(screen.findByTestId('native-publish-step-1')?.props['aria-current']).toBe('step');
        await act(async () => { screen.pressByTestId('direct-session-directory-toggle:/home/owner/project'); });
        await act(async () => { screen.pressByTestId('direct-session-candidate:native-thread'); });
        expect(screen.findByTestId('native-publish-step-2')?.props['aria-current']).toBe('step');
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(screen.findByTestId('native-publish-step-3')?.props['aria-current']).toBe('step');
        await act(async () => { screen.pressByTestId('native-publish-choose-another'); });
        expect(screen.findByTestId('native-publish-step-1')?.props['aria-current']).toBe('step');
    });

    it('lists the selected host and previews actual text without publishing or taking over', async () => {
        const screen = await openPreview();
        await act(async () => { screen.pressByTestId('native-publish-preview-toggle'); });
        expect(screen.findByTestId('native-publish-preview-message-0')?.props.children).toBe('Practice with me');
        expect(screen.findByTestId('native-publish-preview-message-1')?.props.children).toBe('What did you learn?');
        expect(calls(previewMethod)[0][0]).toMatchObject({ machineId: 'machine-a', serverId: 'server-a', payload: { remoteSessionId: 'native-thread', source: { kind: 'codexHome', home: 'user' } } });
        expect(calls(publishMethod)).toHaveLength(0);
        expect(boundary.rpc.mock.calls.some(([request]) => /link.ensure|takeover/.test(request.method))).toBe(false);
        expect(screen.findByTestId('native-publish-title')?.props.value).toBe('Interview practice');
    });

    it('keeps long history collapsed, reveals every message on demand and preserves the form', async () => {
        const messages = Array.from({ length: 41 }, (_, index) => ({ role: 'user', text: `Message ${index}` }));
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? { ...ready, messages }
            : { ok: true, candidates: [candidate], nextCursor: null });
        const screen = await openPreview();
        expect(screen.findByTestId('native-publish-preview-message-0')).toBeNull();
        expect(screen.findByTestId('native-publish-preview-toggle')?.props.accessibilityState).toEqual({ expanded: false });
        expect(screen.findByTestId('native-publish-generate')).not.toBeNull();
        await act(async () => { screen.findByTestId('native-publish-title')?.props.onChangeText('My title'); });
        await act(async () => { screen.pressByTestId('native-publish-preview-toggle'); });
        expect(screen.findByTestId('native-publish-preview-message-19')?.props.children).toBe('Message 19');
        expect(screen.findByTestId('native-publish-preview-message-20')).toBeNull();
        await act(async () => { screen.pressByTestId('native-publish-preview-more'); });
        await act(async () => { screen.pressByTestId('native-publish-preview-more'); });
        expect(screen.findByTestId('native-publish-preview-message-40')?.props.children).toBe('Message 40');
        expect(screen.findByTestId('native-publish-preview-more')).toBeNull();
        await act(async () => { screen.pressByTestId('native-publish-preview-toggle'); });
        expect(screen.findByTestId('native-publish-preview-message-0')).toBeNull();
        expect(screen.findByTestId('native-publish-title')?.props.value).toBe('My title');
        expect(calls(publishMethod)).toHaveLength(0);
    });

    it('publishes only after review with the exact fingerprint and user-entered title and purpose', async () => {
        const screen = await openPreview();
        await act(async () => {
            screen.findByTestId('native-publish-title')?.props.onChangeText('Interview coach');
            screen.findByTestId('native-publish-description')?.props.onChangeText('One question at a time');
        });
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(calls(publishMethod)[0][0].payload).toMatchObject({ title: 'Interview coach', description: 'One question at a time', expectedSnapshotFingerprint: fingerprint, remoteSessionId: 'native-thread' });
        expect(screen.findByTestId('native-publish-link')?.props.value).toBe(publication.inviteUrl);
        expect(boundary.copy).not.toHaveBeenCalled();
        await act(async () => { screen.pressByTestId('native-publish-copy'); });
        expect(boundary.copy).toHaveBeenCalledWith(publication.inviteUrl);
        expect(boundary.alert).toHaveBeenLastCalledWith('sharedEntry.copied', 'sharedEntry.copiedDetail');
        expect(screen.findByTestId('native-publish-copied')).toBeNull();
    });

    it('does not claim copied when the clipboard rejects the write', async () => {
        boundary.copy.mockResolvedValue(false);
        const screen = await openPreview();
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        await act(async () => { screen.pressByTestId('native-publish-copy'); });
        expect(screen.findByTestId('native-publish-copied')).toBeNull();
        expect(boundary.alert).toHaveBeenLastCalledWith('common.error', 'sharedEntry.copyFailed');
        expect(screen.findByTestId('native-publish-link')?.props.value).toBe(publication.inviteUrl);
    });

    it('keeps edited fields and unlocks when publication recovery also fails', async () => {
        const screen = await openPreview();
        await act(async () => {
            screen.findByTestId('native-publish-title')?.props.onChangeText('Keep my title');
            screen.findByTestId('native-publish-description')?.props.onChangeText('Keep my purpose');
        });
        boundary.rpc.mockRejectedValue(new Error('Connection lost'));
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(screen.findByTestId('native-publish-title')?.props.value).toBe('Keep my title');
        expect(screen.findByTestId('native-publish-description')?.props.value).toBe('Keep my purpose');
        expect(screen.findByTestId('native-publish-generate')?.props.disabled).toBe(false);
        expect(boundary.alert).toHaveBeenCalledExactlyOnceWith('common.error', 'nativeSessionSharing.publishFailed');
        expect(screen.findByTestId('native-publish-error')).toBeNull();
        expect(screen.findByTestId('native-publish-wait-detail')).toBeNull();
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        await screen.update(<NativeSessionPublishScreen />);
        expect(boundary.alert).toHaveBeenCalledTimes(1);
    });

    it('ignores a recovered publication after switching accounts', async () => {
        const screen = await openPreview();
        const pending = createDeferred<unknown>();
        boundary.rpc.mockImplementation(async ({ method }) => {
            if (method === publishMethod) throw new Error('Response lost');
            if (method === previewMethod) return pending.promise;
            return { ok: true, candidates: [candidate], nextCursor: null };
        });
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(screen.findByTestId('native-publish-wait-detail')).not.toBeNull();
        expect(calls(publishMethod)[0][0].timeoutMs).toBe(120_000);
        boundary.token = 'account-b';
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        await screen.update(<NativeSessionPublishScreen />);
        await act(async () => { pending.resolve({ ok: true, status: 'already_published', publication }); });
        expect(screen.findByTestId('native-publish-link')).toBeNull();
        expect(screen.findByTestId('native-publish-error')).toBeNull();
    });

    it('recovers a completed publication after the publish response times out without sending another publish', async () => {
        const screen = await openPreview();
        boundary.rpc.mockImplementation(async ({ method }) => {
            if (method === publishMethod) throw Object.assign(new Error('Response timed out'), { code: 'machine_rpc_timeout' });
            if (method === previewMethod) return { ok: true, status: 'already_published', publication };
            throw new Error('Unexpected RPC');
        });
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(screen.findByTestId('native-publish-link')?.props.value).toBe(publication.inviteUrl);
        expect(screen.findByTestId('native-publish-error')).toBeNull();
        expect(calls(publishMethod)).toHaveLength(1);
    });

    it('reuses an existing publication without previewing new history as its snapshot or publishing again', async () => {
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod
            ? { ok: true, status: 'already_published', publication }
            : { ok: true, candidates: [candidate], nextCursor: null });
        const screen = await openPreview();
        expect(screen.findByTestId('native-publish-reused')).not.toBeNull();
        expect(screen.findByTestId('native-publish-link')?.props.value).toBe(publication.inviteUrl);
        expect(screen.findByTestId('native-publish-preview-message-0')).toBeNull();
        expect(screen.findByTestId('native-publish-generate')).toBeNull();
        expect(calls(publishMethod)).toHaveLength(0);
    });

    it('requires a fresh preview after the source changes without automatically retrying publication', async () => {
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? ready
            : method === publishMethod ? { ok: false, errorCode: 'snapshot_changed', error: 'changed' }
            : { ok: true, candidates: [candidate], nextCursor: null });
        const screen = await openPreview();
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(screen.findByTestId('native-publish-generate')).toBeNull();
        expect(screen.findByTestId('native-publish-preview-retry')).not.toBeNull();
        expect(calls(publishMethod)).toHaveLength(1);
        await act(async () => { screen.pressByTestId('native-publish-preview-retry'); });
        expect(calls(previewMethod)).toHaveLength(2);
        expect(calls(publishMethod)).toHaveLength(1);
    });

    it('explains that an empty account sees only its connected computers', async () => {
        boundary.machines = [];
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        expect(screen.findByTestId('native-publish-no-machines')).not.toBeNull();
        expect(boundary.rpc).not.toHaveBeenCalled();
        expect(screen.findByTestId('native-publish-connect-machine')).not.toBeNull();
    });

    it('opens usable source setup for a new publisher and returns to selection once connected', async () => {
        boundary.machines = [];
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        await act(async () => { screen.pressByTestId('native-publish-connect-machine'); });
        expect(screen.findByTestId('session-getting-started-source-guide')).not.toBeNull();
        expect(boundary.push).not.toHaveBeenCalled();
        boundary.machines = [{ id: 'machine-a', active: true, metadata: { displayName: 'My Mac' } }];
        await screen.update(<NativeSessionPublishScreen />);
        expect(screen.findByTestId('direct-session-directory-toggle:/home/owner/project')).not.toBeNull();
        expect(screen.findByTestId('session-getting-started-source-guide')).toBeNull();
    });

    it('keeps the selected host, reviewed text and form through an outage, then can publish after reconnection', async () => {
        boundary.machines.push({ id: 'machine-b', active: true, metadata: { displayName: 'Other PC' } });
        const screen = await openPreview();
        await act(async () => {
            screen.findByTestId('native-publish-title')?.props.onChangeText('Edited title');
            screen.findByTestId('native-publish-description')?.props.onChangeText('Edited purpose');
        });
        boundary.machines = boundary.machines.map(machine => machine.id === 'machine-a' ? { ...machine, active: false } : machine);
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        await screen.update(<NativeSessionPublishScreen />);
        expect(screen.findByTestId('native-publish-offline')).not.toBeNull();
        await act(async () => { screen.pressByTestId('native-publish-preview-toggle'); });
        expect(screen.findByTestId('native-publish-preview-message-0')?.props.children).toBe('Practice with me');
        expect(screen.findByTestId('native-publish-title')?.props.value).toBe('Edited title');
        expect(screen.findByTestId('native-publish-generate')?.props.disabled).toBe(true);
        expect(boundary.rpc.mock.calls.some(([request]) => request.machineId === 'machine-b')).toBe(false);
        boundary.machines = boundary.machines.map(machine => ({ ...machine, active: true }));
        await screen.update(<NativeSessionPublishScreen />);
        expect(screen.findByTestId('native-publish-description')?.props.value).toBe('Edited purpose');
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(calls(publishMethod)[0][0].payload.title).toBe('Edited title');
    });

    it('can still copy the completed publication while its host is offline', async () => {
        const screen = await openPreview();
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        boundary.machines = boundary.machines.map(machine => ({ ...machine, active: false }));
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        await screen.update(<NativeSessionPublishScreen />);
        expect(screen.findByTestId('native-publish-link')?.props.value).toBe(publication.inviteUrl);
        await act(async () => { screen.pressByTestId('native-publish-copy'); });
        expect(boundary.alert).toHaveBeenLastCalledWith('sharedEntry.copied', 'sharedEntry.copiedDetail');
        expect(screen.findByTestId('native-publish-copied')).toBeNull();
        expect(calls(publishMethod)).toHaveLength(1);
    });

    it('can review again when native text is temporarily unavailable', async () => {
        let firstRead = true;
        boundary.rpc.mockImplementation(async ({ method }) => {
            if (method === previewMethod && firstRead) { firstRead = false; return { ok: false, errorCode: 'context_snapshot_unavailable', error: 'still writing' }; }
            if (method === previewMethod) return ready;
            return { ok: true, candidates: [candidate], nextCursor: null };
        });
        const screen = await openPreview();
        expect(screen.findByTestId('native-publish-preview-retry')).not.toBeNull();
        await act(async () => { screen.pressByTestId('native-publish-preview-retry'); });
        await act(async () => { screen.pressByTestId('native-publish-preview-toggle'); });
        expect(screen.findByTestId('native-publish-preview-message-0')?.props.children).toBe('Practice with me');
        expect(calls(publishMethod)).toHaveLength(0);
    });

    it('keeps an offline machine selectable and explains reconnection without reading it', async () => {
        boundary.machines.push({ id: 'machine-b', active: false, metadata: { displayName: 'Offline PC' } });
        const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
        const screen = await renderScreen(<NativeSessionPublishScreen />);
        await act(async () => { screen.pressByTestId('native-publish-machine-machine-b'); });
        expect(screen.findByTestId('native-publish-offline')).not.toBeNull();
        expect(boundary.rpc.mock.calls.some(([request]) => request.machineId === 'machine-b')).toBe(false);
        expect(screen.findByTestId('direct-session-candidate:native-thread')).toBeNull();
    });

    it.each(['account', 'server', 'machine'])('drops a delayed preview after switching %s', async (scope) => {
        const pending = createDeferred<unknown>();
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? pending.promise : { ok: true, candidates: [candidate], nextCursor: null });
        boundary.machines.push({ id: 'machine-b', active: true, metadata: { displayName: 'Other PC' } });
        const screen = await openPreview();
        if (scope === 'machine') await act(async () => { screen.pressByTestId('native-publish-machine-machine-b'); });
        else {
            if (scope === 'account') boundary.token = 'account-b';
            else boundary.server = { ...boundary.server, serverId: 'server-b', generation: 2 };
            const { NativeSessionPublishScreen } = await import('./NativeSessionPublishScreen');
            await screen.update(<NativeSessionPublishScreen />);
        }
        await act(async () => { pending.resolve({ ok: false, errorCode: 'machine_offline', error: 'late failure' }); });
        expect(boundary.alert).not.toHaveBeenCalled();
        expect(screen.findByTestId('native-publish-preview-message-0')).toBeNull();
        expect(screen.findByTestId('native-publish-generate')).toBeNull();
    });

    it('waits for a real preview before asking for publication details', async () => {
        const pending = createDeferred<unknown>();
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? pending.promise : { ok: true, candidates: [candidate], nextCursor: null });
        const screen = await openPreview();
        expect(screen.findByTestId('native-publish-title')).toBeNull();
        expect(screen.findByTestId('native-publish-generate')).toBeNull();
        await act(async () => { pending.resolve(ready); });
        expect(screen.findByTestId('native-publish-title')).not.toBeNull();
    });

    it('keeps a long native title within the publication limit before the user submits', async () => {
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? ready
            : method === publishMethod ? { ok: true, publication }
            : { ok: true, candidates: [{ ...candidate, title: 'x'.repeat(160) }], nextCursor: null });
        const screen = await openPreview();
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(screen.findByTestId('native-publish-link')?.props.value).toBe(publication.inviteUrl);
        expect(calls(publishMethod)[0][0].payload.title.length).toBeLessThanOrEqual(120);
    });

    it.each(['publication_capture_conflict', 'context_snapshot_too_large'])('does not offer blind retries for %s', async (errorCode) => {
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? ready
            : method === publishMethod ? { ok: false, errorCode, error: 'private diagnostic details' }
            : { ok: true, candidates: [candidate], nextCursor: null });
        const screen = await openPreview();
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        expect(screen.findByTestId('native-publish-generate')).toBeNull();
        expect(screen.findByTestId('native-publish-preview-retry')).toBeNull();
        expect(screen.findByTestId('native-publish-choose-another')).not.toBeNull();
        expect(boundary.alert.mock.calls.at(-1)?.[1]).not.toContain('private diagnostic');
        expect(boundary.alert).toHaveBeenCalledTimes(1);
    });

    it('retains the reviewed name and purpose while reloading a changed snapshot', async () => {
        boundary.rpc.mockImplementation(async ({ method }) => method === previewMethod ? ready
            : method === publishMethod ? { ok: false, errorCode: 'snapshot_changed', error: 'changed' }
            : { ok: true, candidates: [candidate], nextCursor: null });
        const screen = await openPreview();
        await act(async () => {
            screen.findByTestId('native-publish-title')?.props.onChangeText('My edited title');
            screen.findByTestId('native-publish-description')?.props.onChangeText('My edited purpose');
        });
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        await act(async () => { screen.pressByTestId('native-publish-preview-retry'); });
        expect(screen.findByTestId('native-publish-title')?.props.value).toBe('My edited title');
        expect(screen.findByTestId('native-publish-description')?.props.value).toBe('My edited purpose');
    });

    it('can retry a failed copy without publishing another session', async () => {
        boundary.copy.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        const screen = await openPreview();
        await act(async () => { screen.pressByTestId('native-publish-generate'); });
        await act(async () => { screen.pressByTestId('native-publish-copy'); });
        await act(async () => { screen.pressByTestId('native-publish-copy'); });
        expect(boundary.alert).toHaveBeenLastCalledWith('sharedEntry.copied', 'sharedEntry.copiedDetail');
        expect(screen.findByTestId('native-publish-copied')).toBeNull();
        expect(calls(publishMethod)).toHaveLength(1);
        expect(screen.findByTestId('native-publish-error')).toBeNull();
    });

    it('explains unsupported hosts without exposing raw RPC details', async () => {
        boundary.rpc.mockImplementation(async ({ method }) => {
            if (method === previewMethod) throw Object.assign(new Error('private/path details'), { rpcErrorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE });
            return { ok: true, candidates: [candidate], nextCursor: null };
        });
        const screen = await openPreview();
        expect(boundary.alert).toHaveBeenLastCalledWith('common.error', 'nativeSessionSharing.hostUpdateRequired');
        expect(screen.findByTestId('native-publish-preview-retry')).not.toBeNull();
    });
});
