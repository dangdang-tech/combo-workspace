import React from 'react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { createRootLayoutFeaturesResponse } from '@/dev/testkit/fixtures/featureFixtures';
import { profileDefaults, type Profile } from '@/sync/domains/profiles/profile';
import type { ServerFeaturesRuntimeSnapshot } from '@/sync/domains/features/featureDecisionRuntime';
import { installAccountCommonModuleMocks } from './accountTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    canOpenURL: vi.fn(async () => true),
    openURL: vi.fn(async () => true),
    setPendingExternalConnect: vi.fn(async () => true),
    clearPendingExternalConnect: vi.fn(async () => true),
    refreshProfile: vi.fn(async () => {}),
    serverFetch: vi.fn(),
    snapshot: { status: 'loading' } as ServerFeaturesRuntimeSnapshot,
}));

installAccountCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Linking: { canOpenURL: shared.canOpenURL, openURL: shared.openURL },
        });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ confirmResult: true }).module;
    },
});

vi.mock('expo-image', () => ({ Image: 'Image' }));
vi.mock('@/components/ui/lists/Item', () => ({ Item: 'Item' }));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        setPendingExternalConnect: shared.setPendingExternalConnect,
        clearPendingExternalConnect: shared.clearPendingExternalConnect,
    },
    isLegacyAuthCredentials: (credentials: unknown) => Boolean(credentials),
}));

// The active service capability snapshot and HTTP transport are external boundaries;
// provider resolution, configured-state checks, and connect/disconnect APIs stay real.
vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesRuntimeSnapshot: () => shared.snapshot,
}));
vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getCachedReadyServerFeatures: () => shared.snapshot.status === 'ready' ? shared.snapshot.features : null,
}));
vi.mock('@/sync/http/client', () => ({ serverFetch: shared.serverFetch }));

vi.mock('@/sync/sync', () => ({ sync: { refreshProfile: shared.refreshProfile } }));
vi.mock('@/sync/api/account/apiIdentity', () => ({ setAccountIdentityShowOnProfile: async () => {} }));
vi.mock('@/sync/domains/state/storageStore', () => {
    const storage = { getState: () => ({ profile: profileDefaults }) };
    return { storage, getStorage: () => storage };
});

const credentials = { token: 'current-account-token', secret: 'current-account-secret' };

function setProviders(providers: Record<string, { enabled: boolean; configured: boolean }>) {
    shared.snapshot = {
        status: 'ready',
        features: createRootLayoutFeaturesResponse({ capabilities: { oauth: { providers } } }),
    };
}

async function renderIdentities(profile: Profile = profileDefaults) {
    const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
    return renderScreen(
        <ProviderIdentityItems
            profile={profile}
            credentials={credentials}
            applyProfile={() => {}}
            returnTo="/settings/account"
        />,
    );
}

beforeEach(async () => {
    vi.clearAllMocks();
    setProviders({ github: { enabled: true, configured: true } });
    shared.serverFetch.mockResolvedValue(new Response(JSON.stringify({ url: 'https://accounts.example.test/authorize' })));
    const { Modal } = await import('@/modal');
    vi.mocked(Modal.confirm).mockResolvedValue(true);
});

describe('ProviderIdentityItems', () => {
    it('shows configured Google without an unusable GitHub placeholder', async () => {
        setProviders({ google: { enabled: true, configured: true }, github: { enabled: true, configured: false } });
        const screen = await renderIdentities();
        expect(screen.findByTestId('account-identity-provider-google')).not.toBeNull();
        expect(screen.findByTestId('account-identity-provider-github')).toBeNull();
    });

    it('clears pending connect state and blocks unsafe connect URLs', async () => {
        shared.serverFetch.mockResolvedValue(new Response(JSON.stringify({ url: 'javascript:alert(1)' })));
        const screen = await renderIdentities();
        const { Modal } = await import('@/modal');

        await act(async () => { screen.findByProps({ title: 'GitHub' }).props.onPress(); });

        expect(shared.setPendingExternalConnect).toHaveBeenCalledWith({ provider: 'github', returnTo: '/settings/account' });
        expect(shared.clearPendingExternalConnect).toHaveBeenCalled();
        expect(shared.canOpenURL).not.toHaveBeenCalled();
        expect(shared.openURL).not.toHaveBeenCalled();
        expect(Modal.alert).toHaveBeenCalled();
    });

    it('connects a configured dynamic provider using the current account and preserves GitHub', async () => {
        setProviders({
            github: { enabled: true, configured: true },
            google: { enabled: true, configured: true },
            unconfigured: { enabled: true, configured: false },
        });
        const screen = await renderIdentities();
        expect(screen.findAllByProps({ title: 'GitHub' })).toHaveLength(1);
        expect(screen.findAllByProps({ title: 'Unconfigured' })).toHaveLength(0);
        const google = screen.findByProps({ title: 'Google' });
        expect(google.props.disabled).toBe(false);

        await act(async () => { google.props.onPress(); });

        expect(shared.setPendingExternalConnect).toHaveBeenCalledWith({ provider: 'google', returnTo: '/settings/account' });
        expect(shared.serverFetch).toHaveBeenCalledWith('/v1/connect/external/google/params', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({ Authorization: `Bearer ${credentials.token}` }),
        }), { includeAuth: false });
        expect(shared.openURL).toHaveBeenCalledWith('https://accounts.example.test/authorize');
        expect(shared.clearPendingExternalConnect).not.toHaveBeenCalled();
    });

    it('keeps linked dynamic identities visible and disconnects the same account when configuration is unavailable', async () => {
        setProviders({ github: { enabled: true, configured: false } });
        const screen = await renderIdentities({
            ...profileDefaults,
            linkedProviders: [{
                id: 'google', login: 'member@example.test', displayName: 'Member', avatarUrl: null, profileUrl: null, showOnProfile: false,
            }],
        });
        const google = screen.findByProps({ title: 'Google' });
        expect(google.props.detail).toBe('@member@example.test');
        expect(google.props.subtitle).toBe('settingsAccount.tapToDisconnect');
        expect(screen.findByTestId('account-identity-provider-github')).toBeNull();
        shared.serverFetch.mockResolvedValue(new Response(JSON.stringify({ success: true })));

        await act(async () => { google.props.onPress(); });

        expect(shared.serverFetch).toHaveBeenCalledWith('/v1/connect/external/google', expect.objectContaining({
            method: 'DELETE', headers: { Authorization: `Bearer ${credentials.token}` },
        }), { includeAuth: false });
        expect(shared.refreshProfile).toHaveBeenCalled();
        expect(shared.setPendingExternalConnect).not.toHaveBeenCalled();
    });

    it('updates available identities with the current service and fails closed while capabilities are loading', async () => {
        setProviders({ google: { enabled: true, configured: true } });
        const screen = await renderIdentities();
        expect(screen.findByProps({ title: 'Google' }).props.disabled).toBe(false);
        shared.snapshot = { status: 'loading' };
        const { ProviderIdentityItems } = await import('./ProviderIdentityItems');
        await act(async () => {
            screen.update(<ProviderIdentityItems profile={{ ...profileDefaults }} credentials={credentials} applyProfile={() => {}} returnTo="/settings/account" />);
        });
        expect(screen.findAllByProps({ title: 'Google' })).toHaveLength(0);
        expect(screen.findByProps({ title: 'GitHub' }).props.disabled).toBe(true);
        expect(shared.serverFetch).not.toHaveBeenCalled();
    });
});
