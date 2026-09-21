import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDeferred, renderScreen } from '@/dev/testkit';
const boundary = vi.hoisted(() => ({ fetch: vi.fn(), push: vi.fn(), replace: vi.fn(), authenticated: true, switchServer: vi.fn(), copy: vi.fn(), prompt: vi.fn() }));
vi.mock('@/sync/http/client', () => ({ serverFetch: boundary.fetch }));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/createSessionRequestWithServerScope', () => ({ createSessionRequestWithServerScope: ({ activeRequest }: { activeRequest: unknown }) => activeRequest }));
vi.mock('@/auth/context/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: boundary.authenticated, refreshFromActiveServer: async () => {} }) }));
vi.mock('@/sync/domains/server/serverProfiles', () => ({ getActiveServerSnapshot: () => ({ serverId: 'relay', serverUrl: 'https://relay.example' }), getServerProfileById: (id: string) => ({ id, serverUrl: id === 'relay-b' ? 'https://second-relay.example' : 'https://relay.example' }) }));
vi.mock('@/sync/domains/server/activeServerSwitch', () => ({ upsertActivateAndSwitchServer: boundary.switchServer }));
vi.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
vi.mock('expo-router', async () => { const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router'); return createExpoRouterMock({ router: { push: boundary.push, replace: boundary.replace } }).module; });
vi.mock('react-native', async () => { const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative'); return createReactNativeWebMock(); });
vi.mock('react-native-unistyles', async () => { const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles'); return createUnistylesMock(); });
vi.mock('@/text', async () => { const { createTextModuleMock } = await import('@/dev/testkit/mocks/text'); return createTextModuleMock(); });
vi.mock('@/components/ui/lists/Item', () => ({ Item: (props: any) => React.createElement('Item', props) }));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: (props: any) => React.createElement('ItemGroup', props, props.children) }));
vi.mock('@/components/ui/lists/ItemList', () => ({ ItemList: (props: any) => React.createElement('ItemList', props, props.children) }));
const access = { entryId: 'e', title: 'Website', memberId: 'm', status: 'pending', sessionId: null, hostOnline: true, errorCode: null };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('SharedEntryInviteScreen', () => {
    beforeEach(() => { vi.clearAllMocks(); boundary.fetch.mockReset(); boundary.authenticated = true; });
    it('preserves the invite and server on the existing login route without redeeming signed out', async () => {
        boundary.authenticated = false;
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token="token" serverUrl="https://relay.example" />);
        await act(async () => { screen.pressByTestId('shared-entry-accept'); });
        expect(boundary.fetch).not.toHaveBeenCalled();
        expect(boundary.push).toHaveBeenCalledWith({ pathname: '/', params: { returnTo: '/invite/token?server=https%3A%2F%2Frelay.example' } });
    });
    it('keeps allocation pending visible until a real ready response, then enters the dedicated session', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ access }));
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token="token" />);
        await act(async () => { screen.pressByTestId('shared-entry-accept'); });
        expect(screen.findByTestId('shared-entry-preparing')).not.toBeNull();
        expect(boundary.replace).not.toHaveBeenCalled();
        boundary.fetch.mockResolvedValueOnce(response({ access: { ...access, status: 'ready', sessionId: 'my-child' } }));
        await act(async () => { screen.pressByTestId('shared-entry-refresh'); });
        expect(boundary.replace).toHaveBeenCalledWith('/session/my-child?serverId=relay');
    });
    it('shows an offline refusal and retries only on user intent', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ error: 'host_offline' }, 409));
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token="token" />);
        await act(async () => { screen.pressByTestId('shared-entry-accept'); });
        expect(screen.findByTestId('shared-entry-error')?.props.title).toBe('sharedEntry.inviteHostOffline');
        expect(boundary.fetch).toHaveBeenCalledTimes(1);
        expect(boundary.replace).not.toHaveBeenCalled();
    });
    it('switches a different target server before allowing login or redemption', async () => {
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token="token" serverUrl="https://another.example" />);
        expect(screen.findByTestId('shared-entry-accept')).toBeNull();
        await act(async () => { screen.pressByTestId('shared-entry-switch-server'); });
        expect(boundary.switchServer).toHaveBeenCalledWith(expect.objectContaining({ serverUrl: 'https://another.example' }));
        expect(boundary.fetch).not.toHaveBeenCalled();
    });
    it.each([
        ['context_snapshot_required', 'sharedEntry.contextSnapshotRequired'],
        ['context_snapshot_too_large', 'sharedEntry.contextSnapshotTooLarge'],
        ['context_snapshot_unavailable', 'sharedEntry.contextSnapshotUnavailable'],
    ])('explains a failed allocation caused by %s without replaying redemption', async (errorCode, message) => {
        boundary.fetch.mockResolvedValueOnce(response({ access: { ...access, status: 'failed', errorCode } }));
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token="token" />);
        await act(async () => { screen.pressByTestId('shared-entry-accept'); });
        expect(screen.findByTestId('shared-entry-preparation-failed')?.props.title).toBe('sharedEntry.inviteSnapshotUnavailable');
        expect(screen.findByTestId('shared-entry-accept')).toBeNull();
        expect(boundary.fetch).toHaveBeenCalledTimes(1);
        expect(boundary.replace).not.toHaveBeenCalled();
    });

    it('derives the three-step guidance from authentication and confirmed access only', async () => {
        boundary.authenticated = false;
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token={'a'.repeat(43)} />);
        expect(screen.findByTestId('shared-entry-progress')?.props.title).toBe('sharedEntry.inviteStepSignIn');
        expect(screen.findByTestId('shared-entry-progress')?.props.subtitle).toBe('sharedEntry.inviteSteps');
        expect(boundary.fetch).not.toHaveBeenCalled();
        boundary.authenticated = true;
        await screen.update(<SharedEntryInviteScreen token={'a'.repeat(43)} />);
        expect(screen.findByTestId('shared-entry-progress')?.props.title).toBe('sharedEntry.inviteStepPrepare');
        expect(screen.findByTestId('shared-entry-accept')?.props.title).toBe('sharedEntry.prepareCopy');
        boundary.fetch.mockResolvedValueOnce(response({ access: { ...access, status: 'ready', sessionId: 'my-child', hostOnline: false } }));
        await act(async () => { screen.pressByTestId('shared-entry-accept'); });
        expect(screen.findByTestId('shared-entry-progress')?.props.title).toBe('sharedEntry.inviteStepOpen');
        expect(boundary.replace).toHaveBeenCalledWith('/session/my-child?serverId=relay');
    });
    it.each([
        ['google_identity_required', '/settings/account', 'sharedEntry.linkGoogle'],
        ['content_keys_required', '/restore', 'sharedEntry.restoreKeys'],
    ])('offers existing recovery for %s and carries the invite back without redeeming again', async (code, destination, label) => {
        const token = 'a'.repeat(43);
        const returnTo = `/invite/${token}?server=https%3A%2F%2Frelay.example`;
        boundary.fetch.mockResolvedValueOnce(response({ error: code }, 409));
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token={token} serverUrl="https://relay.example" />);
        await act(async () => { screen.pressByTestId('shared-entry-accept'); });
        expect(screen.findByTestId('shared-entry-accept')).toBeNull();
        expect(screen.findByTestId('shared-entry-recover')?.props.title).toBe(label);
        await act(async () => { screen.pressByTestId('shared-entry-recover'); });
        expect(boundary.push).toHaveBeenCalledWith(`${destination}?returnTo=${encodeURIComponent(returnTo)}`);
        expect(boundary.fetch).toHaveBeenCalledTimes(1);
    });
    it.each(['context_snapshot_required', 'context_snapshot_too_large', 'context_snapshot_unavailable', 'invite_not_found', 'shared_session_access_revoked'])('does not offer another allocation after an unrecoverable %s refusal', async (code) => {
        boundary.fetch.mockResolvedValueOnce(response({ error: code }, 409));
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token={'a'.repeat(43)} />);
        await act(async () => { screen.pressByTestId('shared-entry-accept'); });
        expect(screen.findByTestId('shared-entry-accept')).toBeNull();
        expect(screen.findByTestId('shared-entry-recover')).toBeNull();
        expect(boundary.fetch).toHaveBeenCalledTimes(1);
    });
    it('keeps a pending offline copy read-only until the host returns', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ access: { ...access, hostOnline: false } }));
        const { SharedEntryInviteScreen } = await import('./SharedEntryInviteScreen');
        const screen = await renderScreen(<SharedEntryInviteScreen token={'a'.repeat(43)} />);
        await act(async () => { screen.pressByTestId('shared-entry-accept'); });
        expect(screen.findByTestId('shared-entry-preparing')?.props.subtitle).toBe('sharedEntry.inviteHostOfflineWaiting');
        expect(screen.findByTestId('shared-entry-accept')).toBeNull();
        boundary.fetch.mockResolvedValueOnce(response({ access: { ...access, status: 'ready', sessionId: 'my-child' } }));
        await act(async () => { screen.pressByTestId('shared-entry-refresh'); });
        expect(boundary.fetch.mock.calls.map(([, init]) => init?.method ?? 'GET')).toEqual(['POST', 'GET']);
        expect(boundary.replace).toHaveBeenCalledWith('/session/my-child?serverId=relay');
    });
});

vi.mock('expo-clipboard', () => ({ setStringAsync: boundary.copy }));
vi.mock('@/modal', async () => { const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal'); return createModalModuleMock({ spies: { prompt: boundary.prompt } }).module; });
describe('SharedEntryManagement', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        boundary.fetch.mockReset();
        boundary.prompt.mockReset().mockResolvedValue('Website helper');
        boundary.copy.mockReset().mockResolvedValue(true);
        const { Modal } = await import('@/modal');
        vi.mocked(Modal.confirm).mockReset().mockResolvedValue(true);
    });
    const legacy = { id: 'legacy', title: 'Original invitation', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasContextSnapshot: false };
    const fresh = { ...legacy, id: 'fresh', title: 'New context', createdAt: 2, hasContextSnapshot: true };
    const oldMember = { id: 'member', userId: 'old-user', username: 'original guest', enabled: true, status: 'ready', sessionId: 'original-child', errorCode: null };

    it('keeps low-frequency invitation management collapsed until explicitly expanded', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [fresh, legacy] })).mockResolvedValueOnce(response({ members: [oldMember] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);

        boundary.fetch.mockResolvedValueOnce(response({ inviteToken: 'selected-token' }));
        await act(async () => { screen.pressByTestId('shared-entry-rotate'); });
        expect(screen.findByTestId('shared-entry-rotate')).toBeNull();
        expect(screen.findByTestId('shared-entry-create-fresh')).toBeNull();
        expect(screen.findByTestId('shared-entry-select-legacy')).toBeNull();
        expect(screen.findByTestId('shared-entry-member-member')?.props.title).toBe('original guest');
        await act(async () => { screen.pressByTestId('shared-entry-management-toggle'); });
        expect(screen.findByTestId('shared-entry-create-fresh')).not.toBeNull();
        expect(screen.findByTestId('shared-entry-rotate')).not.toBeNull();
        expect(screen.findByTestId('shared-entry-select-legacy')).not.toBeNull();
        await act(async () => { screen.pressByTestId('shared-entry-management-toggle'); });
        expect(screen.findByTestId('shared-entry-create-fresh')).toBeNull();
        expect(screen.findByTestId('shared-entry-member-member')?.props.title).toBe('original guest');
        expect(screen.findByTestId('shared-entry-rotate')).toBeNull();
        expect(boundary.fetch).toHaveBeenCalledTimes(3);
    });

    it('cancels link replacement without rotating or losing the current token and members', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [fresh] })).mockResolvedValueOnce(response({ members: [oldMember] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const { Modal } = await import('@/modal');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        boundary.fetch.mockResolvedValueOnce(response({ inviteToken: 'selected-token' }));
        await act(async () => { screen.pressByTestId('shared-entry-rotate'); });
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        await act(async () => { screen.pressByTestId('shared-entry-management-toggle'); });
        vi.mocked(Modal.confirm).mockResolvedValueOnce(false);
        boundary.fetch.mockResolvedValueOnce(response({ inviteToken: 'replacement-token' }));

        await act(async () => { screen.pressByTestId('shared-entry-rotate'); });
        expect(boundary.fetch.mock.calls.filter(([path]) => path === '/v1/shared-session-entries/fresh/invite')).toHaveLength(1);
        expect(screen.findByTestId('shared-entry-member-member')?.props.title).toBe('original guest');
        expect(screen.findByTestId('shared-entry-copy')?.props.accessibilityLabel).toBe('sharedEntry.copied');
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        expect(boundary.copy).toHaveBeenLastCalledWith(expect.stringContaining('/invite/selected-token?server='));
    });

    it('does not show copy success when the clipboard reports a failed write', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        boundary.fetch.mockResolvedValueOnce(response({ entry: fresh, inviteToken: 'fresh-token' }));
        await act(async () => { screen.pressByTestId('shared-entry-create'); });
        boundary.copy.mockResolvedValueOnce(false);

        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        expect(boundary.copy).toHaveBeenCalledWith(expect.stringContaining('/invite/fresh-token?server='));
        expect(screen.findByTestId('shared-entry-copy')?.props.accessibilityLabel).toBe('sharedEntry.copy');
        expect(screen.findByTestId('shared-entry-management-error')?.props.title).toBe('sharedEntry.copyFailed');
        expect(screen.findByTestId('shared-entry-copy')?.props.disabled).toBe(false);
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        expect(screen.findByTestId('shared-entry-copy')?.props.accessibilityLabel).toBe('sharedEntry.copied');
        expect(screen.findByTestId('shared-entry-management-error')).toBeNull();
        boundary.copy.mockRejectedValueOnce(new Error('Clipboard permission denied'));
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        expect(screen.findByTestId('shared-entry-copy')?.props.accessibilityLabel).toBe('sharedEntry.copy');
        expect(screen.findByTestId('shared-entry-management-error')?.props.title).toBe('sharedEntry.copyFailed');
    });

    it('recovers a legacy invitation directly by creating a new invitation while retaining access to the original members', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [legacy] })).mockResolvedValueOnce(response({ members: [oldMember] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        expect(screen.findByTestId('shared-entry-snapshot-missing')?.props.title).toBe('sharedEntry.snapshotMissing');
        expect(screen.findByTestId('shared-entry-rotate')).toBeNull();
        expect(screen.findByTestId('shared-entry-create-fresh')).not.toBeNull();
        expect(boundary.fetch).toHaveBeenCalledTimes(2);

        boundary.fetch.mockResolvedValueOnce(response({ entry: fresh, inviteToken: 'fresh-token' }));
        await act(async () => { screen.pressByTestId('shared-entry-create-fresh'); });
        const [path, init] = boundary.fetch.mock.calls[2];
        expect(path).toBe('/v1/shared-session-entries');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ title: 'Website helper', sourceSessionId: 'source', machineId: 'host' });
        expect(screen.findByTestId('shared-entry-member-member')).toBeNull();
        expect(screen.findByTestId('shared-entry-snapshot-missing')).toBeNull();
        await act(async () => { screen.pressByTestId('shared-entry-management-toggle'); });
        expect(screen.findByTestId('shared-entry-select-fresh')?.props.selected).toBe(true);
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        expect(boundary.copy).toHaveBeenLastCalledWith(expect.stringContaining('/invite/fresh-token?server='));

        boundary.fetch.mockResolvedValueOnce(response({ entries: [legacy, { ...fresh, id: 'unrelated', sourceSessionId: 'other-source' }, fresh] }))
            .mockResolvedValueOnce(response({ members: [] }));
        await act(async () => { screen.pressByTestId('shared-entry-members-refresh'); });
        expect(boundary.fetch.mock.calls[4][0]).toBe('/v1/shared-session-entries/fresh/members');
        expect(screen.findByTestId('shared-entry-select-fresh')?.props.selected).toBe(true);
        expect(screen.findByTestId('shared-entry-select-unrelated')).toBeNull();
        expect(screen.findByTestId('shared-entry-copy')).not.toBeNull();

        boundary.fetch.mockResolvedValueOnce(response({ members: [oldMember] }));
        await act(async () => { screen.pressByTestId('shared-entry-select-legacy'); });
        expect(boundary.fetch.mock.calls[5][0]).toBe('/v1/shared-session-entries/legacy/members');
        expect(screen.findByTestId('shared-entry-member-member')?.props.title).toBe('original guest');
        expect(screen.findByTestId('shared-entry-copy')).toBeNull();
        boundary.fetch.mockResolvedValueOnce(response({ member: { ...oldMember, enabled: false, status: 'revoked' } }));
        await act(async () => { screen.pressByTestId('shared-entry-member-member'); });
        expect(boundary.fetch.mock.calls[6][0]).toBe('/v1/shared-session-entries/legacy/members/member');
        expect(boundary.fetch.mock.calls.filter(([, request]) => request?.method === 'DELETE')).toHaveLength(0);
    });

    it.each(['cancel', 'failure'])('keeps the selected invitation, token and members after a fresh-create %s', async (result) => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [fresh] })).mockResolvedValueOnce(response({ members: [oldMember] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        await act(async () => { screen.pressByTestId('shared-entry-management-toggle'); });
        boundary.fetch.mockResolvedValueOnce(response({ inviteToken: 'selected-token' }));
        await act(async () => { screen.pressByTestId('shared-entry-rotate'); });
        if (result === 'cancel') boundary.prompt.mockResolvedValueOnce(null);
        else boundary.fetch.mockResolvedValueOnce(response({ error: 'context_snapshot_too_large' }, 409));
        await act(async () => { screen.pressByTestId('shared-entry-create-fresh'); });
        expect(screen.findByTestId('shared-entry-member-member')?.props.title).toBe('original guest');
        expect(screen.findByTestId('shared-entry-select-legacy')).toBeNull();
        expect(boundary.fetch.mock.calls.filter(([path, request]) => path === '/v1/shared-session-entries' && request?.method === 'POST')).toHaveLength(result === 'cancel' ? 0 : 1);
        if (result === 'failure') expect(screen.findByTestId('shared-entry-management-error')?.props.title).toBe('sharedEntry.contextSnapshotTooLarge');
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        expect(boundary.copy).toHaveBeenLastCalledWith(expect.stringContaining('/invite/selected-token?server='));
    });

    it.each(['rotate', 'member'])('serializes invitation selection with a pending %s mutation', async (operation) => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [fresh, legacy] })).mockResolvedValueOnce(response({ members: [oldMember] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        await act(async () => { screen.pressByTestId('shared-entry-management-toggle'); });
        const mutation = createDeferred<Response>();
        boundary.fetch.mockReturnValueOnce(mutation.promise);
        await act(async () => { screen.pressByTestId(operation === 'rotate' ? 'shared-entry-rotate' : 'shared-entry-member-member'); });
        expect(screen.findByTestId('shared-entry-select-legacy')?.props.disabled).toBe(true);
        await act(async () => { screen.pressByTestId('shared-entry-select-legacy'); });
        expect(boundary.fetch).toHaveBeenCalledTimes(3);
        await act(async () => { mutation.resolve(response(operation === 'rotate' ? { inviteToken: 'fresh-only' } : { member: { ...oldMember, enabled: false, status: 'revoked' } })); });
        expect(screen.findByTestId('shared-entry-select-legacy')?.props.disabled).toBe(false);
        boundary.fetch.mockResolvedValueOnce(response({ members: [{ ...oldMember, username: 'legacy guest' }] }));
        await act(async () => { screen.pressByTestId('shared-entry-select-legacy'); });
        expect(screen.findByTestId('shared-entry-select-legacy')?.props.selected).toBe(true);
        expect(screen.findByTestId('shared-entry-member-member')?.props.title).toBe('legacy guest');
        expect(screen.findByTestId('shared-entry-member-member')?.props.subtitle).toContain('sharedEntry.canUse');
        expect(screen.findByTestId('shared-entry-copy')).toBeNull();
    });

    it.each([
        ['context_snapshot_required', 'sharedEntry.contextSnapshotRequired'],
        ['context_snapshot_too_large', 'sharedEntry.contextSnapshotTooLarge'],
        ['context_snapshot_unavailable', 'sharedEntry.contextSnapshotUnavailable'],
    ])('explains failed member preparation caused by %s', async (errorCode, message) => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [legacy] })).mockResolvedValueOnce(response({ members: [{ ...oldMember, status: 'failed', errorCode }] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        expect(screen.findByTestId('shared-entry-member-member')?.props.subtitle).toContain(message);
        expect(boundary.fetch).toHaveBeenCalledTimes(2);
    });
    it('creates an entry tied to the source and copies an invite with its relay', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        boundary.fetch.mockResolvedValueOnce(response({ entry: { id: 'e', title: 'Website helper', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasContextSnapshot: true }, inviteToken: 'new-invite' }));
        await act(async () => { screen.pressByTestId('shared-entry-create'); });
        expect(JSON.parse(boundary.fetch.mock.calls[1][1].body)).toEqual({ title: 'Website helper', sourceSessionId: 'source', machineId: 'host' });
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        expect(boundary.copy).toHaveBeenCalledWith(expect.stringContaining('/invite/new-invite?server=https%3A%2F%2Frelay.example'));
    });
    it('disables a member only after the server confirms and keeps existing members on refresh failure', async () => {
        const entry = { id: 'e', title: 'Website', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasContextSnapshot: true };
        const member = { id: 'm', userId: 'u', username: 'guest', enabled: true, status: 'ready', sessionId: 'child', errorCode: null };
        boundary.fetch.mockResolvedValueOnce(response({ entries: [entry] })).mockResolvedValueOnce(response({ members: [member] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        boundary.fetch.mockResolvedValueOnce(response({ member: { ...member, enabled: false, status: 'revoked' } }));
        await act(async () => { screen.pressByTestId('shared-entry-member-m'); });
        expect(JSON.parse(boundary.fetch.mock.calls[2][1].body)).toEqual({ enabled: false });
        expect(screen.findByTestId('shared-entry-member-m')?.props.subtitle).toContain('sharedEntry.disabled');
        boundary.fetch.mockRejectedValueOnce(new Error('Network offline'));
        await act(async () => { screen.pressByTestId('shared-entry-members-refresh'); });
        expect(screen.findByTestId('shared-entry-member-m')).not.toBeNull();
        expect(screen.findByTestId('shared-entry-management-error')).not.toBeNull();
    });
    it.each([
        { sourceSessionId: 'source-b', serverId: 'relay' },
        { sourceSessionId: 'source', serverId: 'relay-b' },
    ])('ignores a delayed create after switching to $sourceSessionId on $serverId', async (nextScope) => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        const oldCreate = createDeferred<Response>();
        boundary.fetch.mockReturnValueOnce(oldCreate.promise);
        await act(async () => { screen.pressByTestId('shared-entry-create'); });
        expect(boundary.fetch).toHaveBeenCalledTimes(2);
        const newLoad = createDeferred<Response>();
        boundary.fetch.mockReturnValueOnce(newLoad.promise);
        await screen.update(<SharedEntryManagement {...nextScope} machineId="host" title="Next website" />);
        expect(screen.findByTestId('shared-entry-create')).toBeNull();
        await act(async () => { newLoad.resolve(response({ entries: [] })); });
        await act(async () => { oldCreate.resolve(response({ entry: { id: 'old-entry', title: 'Old website', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasContextSnapshot: true }, inviteToken: 'old-invite' })); });
        expect(screen.findByTestId('shared-entry-copy')).toBeNull();
        expect(screen.findByTestId('shared-entry-create')?.props.disabled).toBe(false);
    });
    it('clears the previous members and ignores a delayed invite rotation on a new server', async () => {
        const entry = { id: 'entry', title: 'Website', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasContextSnapshot: true };
        const member = { id: 'old-member', userId: 'old-user', username: 'old guest', enabled: true, status: 'ready', sessionId: 'child', errorCode: null };
        boundary.fetch.mockResolvedValueOnce(response({ entries: [entry] })).mockResolvedValueOnce(response({ members: [member] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        const oldRotation = createDeferred<Response>();
        boundary.fetch.mockReturnValueOnce(oldRotation.promise);
        await act(async () => { screen.pressByTestId('shared-entry-rotate'); });
        const newLoad = createDeferred<Response>();
        boundary.fetch.mockReturnValueOnce(newLoad.promise).mockResolvedValueOnce(response({ members: [] }));
        await screen.update(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay-b" />);
        expect(screen.findByTestId('shared-entry-member-old-member')).toBeNull();
        expect(screen.findByTestId('shared-entry-rotate')).toBeNull();
        await act(async () => { newLoad.resolve(response({ entries: [entry] })); });
        await act(async () => { oldRotation.resolve(response({ inviteToken: 'old-invite' })); });
        expect(screen.findByTestId('shared-entry-copy')).toBeNull();
        boundary.fetch.mockResolvedValueOnce(response({ inviteToken: 'new-invite' }));
        await act(async () => { screen.pressByTestId('shared-entry-rotate'); });
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        expect(boundary.copy).toHaveBeenCalledWith(expect.stringContaining('/invite/new-invite?server=https%3A%2F%2Fsecond-relay.example'));
    });
    it('does not create on the old source when its pending name prompt completes after a switch', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        const name = createDeferred<string>();
        boundary.prompt.mockReturnValueOnce(name.promise);
        await act(async () => { screen.pressByTestId('shared-entry-create'); });
        boundary.fetch.mockResolvedValueOnce(response({ entries: [] }));
        await screen.update(<SharedEntryManagement sourceSessionId="source-b" machineId="host" title="Next website" serverId="relay" />);
        await act(async () => { name.resolve('Old source name'); });
        expect(boundary.fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0);
        expect(screen.findByTestId('shared-entry-create')?.props.disabled).toBe(false);
    });
    it('does not apply an old member response to a matching id on another server', async () => {
        const entry = { id: 'entry', title: 'Website', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasContextSnapshot: true };
        const member = { id: 'member', userId: 'user', username: 'old guest', enabled: true, status: 'ready', sessionId: 'child', errorCode: null };
        boundary.fetch.mockResolvedValueOnce(response({ entries: [entry] })).mockResolvedValueOnce(response({ members: [member] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        const oldUpdate = createDeferred<Response>();
        boundary.fetch.mockReturnValueOnce(oldUpdate.promise);
        await act(async () => { screen.pressByTestId('shared-entry-member-member'); });
        boundary.fetch.mockResolvedValueOnce(response({ entries: [entry] })).mockResolvedValueOnce(response({ members: [{ ...member, username: 'new guest' }] }));
        await screen.update(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay-b" />);
        await act(async () => { oldUpdate.resolve(response({ member: { ...member, enabled: false, status: 'revoked' } })); });
        expect(screen.findByTestId('shared-entry-member-member')?.props.title).toBe('new guest');
        expect(screen.findByTestId('shared-entry-member-member')?.props.subtitle).toContain('sharedEntry.canUse');
    });
    it('does not mark a new invite copied when an old clipboard write finishes', async () => {
        boundary.fetch.mockResolvedValueOnce(response({ entries: [] }));
        const { SharedEntryManagement } = await import('./SharedEntryManagement');
        const screen = await renderScreen(<SharedEntryManagement sourceSessionId="source" machineId="host" title="Website" serverId="relay" />);
        boundary.fetch.mockResolvedValueOnce(response({ entry: { id: 'entry', title: 'Website', sourceSessionId: 'source', machineId: 'host', createdAt: 1, hasContextSnapshot: true }, inviteToken: 'old-invite' }));
        await act(async () => { screen.pressByTestId('shared-entry-create'); });
        const oldCopy = createDeferred<boolean>();
        boundary.copy.mockReturnValueOnce(oldCopy.promise);
        await act(async () => { screen.pressByTestId('shared-entry-copy'); });
        boundary.fetch.mockResolvedValueOnce(response({ entries: [] }));
        await screen.update(<SharedEntryManagement sourceSessionId="source-b" machineId="host" title="Next website" serverId="relay-b" />);
        expect(screen.findByTestId('shared-entry-copy')).toBeNull();
        boundary.fetch.mockResolvedValueOnce(response({ entry: { id: 'new-entry', title: 'Next website', sourceSessionId: 'source-b', machineId: 'host', createdAt: 1, hasContextSnapshot: true }, inviteToken: 'new-invite' }));
        await act(async () => { screen.pressByTestId('shared-entry-create'); });
        await act(async () => { oldCopy.resolve(true); });
        expect(screen.findByTestId('shared-entry-copy')?.props.accessibilityLabel).toBe('sharedEntry.copy');
    });
});
