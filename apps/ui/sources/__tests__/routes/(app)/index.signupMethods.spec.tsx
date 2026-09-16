import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    createWelcomeFeaturesResponse,
    renderWelcomeScreen,
    waitForWelcomeTestId,
    waitForWelcomeText,
} from './index.testHelpers';
import { flushHookEffects, standardCleanup } from '@/dev/testkit';
import type { ServerFeaturesSnapshot } from '@/sync/api/capabilities/serverFeaturesClient';
import type { FeaturesResponse } from '@happier-dev/protocol';
import { encodeBase64 } from '@/encryption/base64';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-reanimated', async () => {
    const { createReanimatedModuleMock } = await import('@/dev/testkit/mocks/reanimated');
    return createReanimatedModuleMock();
});
vi.mock('react-native-typography', () => ({ iOSUIKit: { title3: {} } }));
vi.mock('@/components/navigation/shell/HomeHeader', () => ({ HomeHeaderNotAuth: () => null }));
vi.mock('@/components/navigation/shell/MainView', () => ({ MainView: () => null }));
vi.mock('@shopify/react-native-skia', () => ({}));

const applyBrandHeroSeenSpy = vi.hoisted(() => vi.fn());
const routeState = vi.hoisted(() => ({ params: {} as { returnTo?: string }, push: vi.fn() }));
const externalAuthState = vi.hoisted(() => ({
    pending: null as null | {
        provider: string; proof?: string; secret?: string; returnTo?: string; serverUrl?: string;
        intent?: 'signup' | 'reset'; finalizeAttempted?: boolean;
    },
    writes: vi.fn(),
    writeSucceeds: true,
    serverSnapshot: { serverId: 'server-a', serverUrl: 'https://relay.example', generation: 1 },
    randomBytes: vi.fn(async (length: number) => new Uint8Array(length).fill(9)),
    clear: vi.fn(),
    getExternalAuthUrl: vi.fn(async (_params: unknown) => 'https://provider.example/authorize'),
    alert: vi.fn(),
    seedKeyPair: vi.fn((seed: Uint8Array) => ({ publicKey: seed, privateKey: seed })),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getPendingExternalAuth: async () => externalAuthState.pending,
        setPendingExternalAuth: async (pending: NonNullable<typeof externalAuthState.pending>) => {
            externalAuthState.writes(pending);
            if (!externalAuthState.writeSucceeds) return false;
            externalAuthState.pending = pending;
            return true;
        },
        clearPendingExternalAuth: async () => {
            externalAuthState.clear();
            externalAuthState.pending = null;
            return true;
        },
    },
    isLegacyAuthCredentials: (credentials: unknown) => Boolean(credentials),
}));
vi.mock('@/auth/providers/registry', () => ({
    getAuthProvider: () => ({
        id: 'github', displayName: 'GitHub', getExternalAuthUrl: externalAuthState.getExternalAuthUrl,
    }),
}));
vi.mock('@/platform/cryptoRandom', () => ({
    getRandomBytesAsync: externalAuthState.randomBytes,
}));
vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => externalAuthState.serverSnapshot,
}));
vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({ spies: { alert: externalAuthState.alert } }).module;
});

vi.mock('expo-router', async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    return createExpoRouterMock({ params: () => routeState.params, router: { push: routeState.push } }).module;
});

vi.mock('@/components/onboarding/unauthShell', async () => {
    const React = await import('react');
    return {
        UnauthenticatedSplitShell: (props: {
            children?: React.ReactNode;
            stepId: string;
            isWelcomeStep: boolean;
            allowMobileBrandHero?: boolean;
            onOpenRelayCustomFlow: () => void;
            onBrandHeroGetStarted: () => void;
            onBack?: () => void;
        }) =>
            React.createElement(
                'UnauthenticatedSplitShell',
                {
                    stepId: props.stepId,
                    isWelcomeStep: props.isWelcomeStep,
                    allowMobileBrandHero: props.allowMobileBrandHero,
                    onOpenRelayCustomFlow: props.onOpenRelayCustomFlow,
                    onBrandHeroGetStarted: props.onBrandHeroGetStarted,
                    hasBack: typeof props.onBack === 'function',
                    testID: `unauth-shell-route-${props.stepId}`,
                },
                props.children,
            ),
        useApplyBrandHeroSeen: () => applyBrandHeroSeenSpy,
    };
});
vi.mock('@/encryption/libsodium.lib', () => ({
    default: {
        crypto_sign_seed_keypair: externalAuthState.seedKeyPair,
    },
}));
vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: false,
        credentials: null,
        login: vi.fn(async () => {}),
        logout: vi.fn(async () => {}),
    }),
}));

vi.mock('@/sync/domains/pending/pendingTerminalConnect', () => ({
    getPendingTerminalConnect: () => null,
    setPendingTerminalConnect: vi.fn(),
    clearPendingTerminalConnect: vi.fn(),
}));

const getReadyServerFeaturesMock = vi.fn(async () =>
    createWelcomeFeaturesResponse({
        signupMethods: [
            { id: 'anonymous', enabled: false },
            { id: 'github', enabled: true },
        ],
        requiredProviders: ['github'],
        autoRedirectEnabled: false,
        autoRedirectProviderId: null,
        providerOffboardingIntervalSeconds: 600,
    }),
);

vi.mock('@/sync/api/capabilities/getReadyServerFeatures', () => ({
    getReadyServerFeatures: getReadyServerFeaturesMock,
}));

const defaultWelcomeFeatures = createWelcomeFeaturesResponse({
    signupMethods: [
        { id: 'anonymous', enabled: false },
        { id: 'github', enabled: true },
    ],
    requiredProviders: ['github'],
    autoRedirectEnabled: false,
    autoRedirectProviderId: null,
    providerOffboardingIntervalSeconds: 600,
});

const getServerFeaturesSnapshotMock = vi.fn(async (_params?: unknown): Promise<ServerFeaturesSnapshot> => ({
    status: 'ready',
    features: defaultWelcomeFeatures,
}));

vi.mock('@/sync/api/capabilities/serverFeaturesClient', () => ({
    getServerFeaturesSnapshot: getServerFeaturesSnapshotMock,
}));

describe('/ (welcome) signup methods', () => {
    beforeEach(() => {
        routeState.params = {};
        routeState.push.mockClear();
        externalAuthState.pending = null;
        externalAuthState.writes.mockClear();
        externalAuthState.writeSucceeds = true;
        externalAuthState.serverSnapshot = { serverId: 'server-a', serverUrl: 'https://relay.example', generation: 1 };
        externalAuthState.randomBytes.mockReset();
        externalAuthState.randomBytes.mockImplementation(async (length: number) => new Uint8Array(length).fill(9));
        externalAuthState.clear.mockClear();
        externalAuthState.alert.mockClear();
        externalAuthState.seedKeyPair.mockClear();
        externalAuthState.getExternalAuthUrl.mockReset();
        externalAuthState.getExternalAuthUrl.mockResolvedValue('https://provider.example/authorize');
        applyBrandHeroSeenSpy.mockReset();
        getReadyServerFeaturesMock.mockReset();
        getReadyServerFeaturesMock.mockResolvedValue(defaultWelcomeFeatures);
        getServerFeaturesSnapshotMock.mockReset();
        getServerFeaturesSnapshotMock.mockResolvedValue({ status: 'ready', features: defaultWelcomeFeatures });
    });
    afterEach(standardCleanup);

    const invitation = '/invite/abc?server=https%3A%2F%2Frelay.example';
    function retainAttemptedAuth(provider = 'github') {
        externalAuthState.pending = {
            provider,
            proof: 'original-proof',
            secret: encodeBase64(new Uint8Array(32).fill(1), 'base64url'),
            returnTo: invitation,
            serverUrl: 'https://relay.example',
            intent: 'reset',
            finalizeAttempted: true,
        };
        return { ...externalAuthState.pending };
    }

    it('restarts the same provider with a fresh proof and the retained account key after ambiguous finalize', async () => {
        vi.resetModules();
        const original = retainAttemptedAuth();
        const screen = await renderWelcomeScreen();
        await waitForWelcomeTestId(screen, 'welcome-signup-provider');
        await screen.pressByTestIdAsync('welcome-signup-provider');
        await flushHookEffects();

        expect(externalAuthState.pending).toEqual(expect.objectContaining({
            secret: original.secret,
            returnTo: invitation,
            intent: 'reset',
            finalizeAttempted: true,
        }));
        expect(externalAuthState.pending?.proof).not.toBe(original.proof);
        expect(externalAuthState.seedKeyPair).toHaveBeenCalledWith(new Uint8Array(32).fill(1));
        expect(externalAuthState.getExternalAuthUrl).toHaveBeenCalledWith(expect.objectContaining({
            mode: 'keyed', publicKey: encodeBase64(new Uint8Array(32).fill(1)),
        }));
        expect(externalAuthState.clear).not.toHaveBeenCalled();
    });

    it.each(['rejected', 'unsafe-url'] as const)('retains the attempted account key when a fresh OAuth start fails (%s)', async (failure) => {
        vi.resetModules();
        const original = retainAttemptedAuth();
        if (failure === 'rejected') externalAuthState.getExternalAuthUrl.mockRejectedValueOnce(new Error('network'));
        else externalAuthState.getExternalAuthUrl.mockResolvedValueOnce('javascript:alert(1)');
        const screen = await renderWelcomeScreen();
        await waitForWelcomeTestId(screen, 'welcome-signup-provider');
        await screen.pressByTestIdAsync('welcome-signup-provider');
        await flushHookEffects();

        expect(externalAuthState.pending).toEqual(expect.objectContaining({ secret: original.secret, finalizeAttempted: true }));
        expect(externalAuthState.clear).not.toHaveBeenCalled();
        expect(externalAuthState.alert).toHaveBeenCalled();
    });

    it('does not replace an attempted account key when another provider is selected', async () => {
        vi.resetModules();
        const original = retainAttemptedAuth('google');
        const screen = await renderWelcomeScreen();
        await waitForWelcomeTestId(screen, 'welcome-signup-provider');
        await screen.pressByTestIdAsync('welcome-signup-provider');
        await flushHookEffects();

        expect(externalAuthState.pending).toEqual(original);
        expect(externalAuthState.writes).not.toHaveBeenCalled();
        expect(externalAuthState.getExternalAuthUrl).not.toHaveBeenCalled();
        expect(externalAuthState.alert).toHaveBeenCalled();
    });

    it('does not start a fresh OAuth request when its updated proof cannot be saved', async () => {
        vi.resetModules();
        const original = retainAttemptedAuth();
        externalAuthState.writeSucceeds = false;
        const screen = await renderWelcomeScreen();
        await waitForWelcomeTestId(screen, 'welcome-signup-provider');
        await screen.pressByTestIdAsync('welcome-signup-provider');
        await flushHookEffects();

        expect(externalAuthState.writes).toHaveBeenCalledTimes(1);
        expect(externalAuthState.pending).toEqual(original);
        expect(externalAuthState.clear).not.toHaveBeenCalled();
        expect(externalAuthState.getExternalAuthUrl).not.toHaveBeenCalled();
        expect(externalAuthState.alert).toHaveBeenCalled();
    });

    it.each(['different-server', 'switch-away-and-back'] as const)('does not move a retained account key across a server change while preparing OAuth (%s)', async (change) => {
        vi.resetModules();
        const original = retainAttemptedAuth();
        let releaseProof!: (bytes: Uint8Array<ArrayBuffer>) => void;
        externalAuthState.randomBytes.mockImplementationOnce(() => new Promise<Uint8Array<ArrayBuffer>>((resolve) => { releaseProof = resolve; }));
        const screen = await renderWelcomeScreen();
        await waitForWelcomeTestId(screen, 'welcome-signup-provider');
        await screen.pressByTestIdAsync('welcome-signup-provider');
        await flushHookEffects();
        expect(externalAuthState.randomBytes).toHaveBeenCalledTimes(1);

        externalAuthState.serverSnapshot = change === 'different-server'
            ? { serverId: 'server-b', serverUrl: 'https://other.example', generation: 2 }
            : { serverId: 'server-a', serverUrl: 'https://relay.example', generation: 3 };
        releaseProof(new Uint8Array(32).fill(9));
        await flushHookEffects();

        expect(externalAuthState.pending).toEqual(original);
        expect(externalAuthState.writes).not.toHaveBeenCalled();
        expect(externalAuthState.getExternalAuthUrl).not.toHaveBeenCalled();
        expect(externalAuthState.clear).not.toHaveBeenCalled();
        expect(externalAuthState.alert).toHaveBeenCalled();
    });

    it('does not replace an attempted account key with a keyless login', async () => {
        vi.resetModules();
        const original = retainAttemptedAuth();
        getServerFeaturesSnapshotMock.mockResolvedValueOnce({
            status: 'ready',
            features: createWelcomeFeaturesResponse({
                signupMethods: [{ id: 'anonymous', enabled: false }],
                authMethods: [{
                    id: 'github',
                    actions: [{ id: 'login', enabled: true, mode: 'keyless' }],
                    ui: { displayName: 'GitHub', iconHint: 'github' },
                }],
            }),
        });
        const screen = await renderWelcomeScreen();
        await waitForWelcomeTestId(screen, 'welcome-create-account');
        await screen.pressByTestIdAsync('welcome-create-account');
        await flushHookEffects();

        expect(externalAuthState.pending).toEqual(original);
        expect(externalAuthState.writes).not.toHaveBeenCalled();
        expect(externalAuthState.getExternalAuthUrl).not.toHaveBeenCalled();
        expect(externalAuthState.alert).toHaveBeenCalled();
    });

    it.each([
        ['/invite/abc?server=https%3A%2F%2Frelay.example', '/restore?returnTo=%2Finvite%2Fabc%3Fserver%3Dhttps%253A%252F%252Frelay.example'],
        ['https://evil.example', '/restore'],
    ])('preserves only an internal continuation when opening restore (%s)', async (returnTo, expected) => {
        vi.resetModules();
        routeState.params = { returnTo };
        const screen = await renderWelcomeScreen();
        await waitForWelcomeTestId(screen, 'welcome-secondary-login');
        await screen.pressByTestIdAsync('welcome-secondary-login');
        expect(routeState.push).toHaveBeenCalledWith(expected);
    });

    it('uses an extended initial server-features timeout before showing the server unavailable state', async () => {
        vi.resetModules();
        const screen = await renderWelcomeScreen();

        expect(screen.root).toBeTruthy();
        expect(getServerFeaturesSnapshotMock).toHaveBeenCalledWith({
            timeoutMs: 6000,
            force: false,
        });
    });

    it('renders the unauthenticated welcome route inside the split shell', async () => {
        vi.resetModules();
        const screen = await renderWelcomeScreen();

        const shell = screen.findByTestId('unauth-shell-route-welcome');
        expect(shell).toBeTruthy();
        expect(shell?.props.stepId).toBe('welcome');
        expect(shell?.props.isWelcomeStep).toBe(true);
        expect(shell?.props.allowMobileBrandHero).toBe(true);

        shell?.props.onBrandHeroGetStarted();
        expect(applyBrandHeroSeenSpy).toHaveBeenCalledTimes(1);

        expect(shell?.props.onOpenRelayCustomFlow).toBeTypeOf('function');
        expect(screen.findAllByTestId('welcome-hero')).toHaveLength(0);
    });

    it('bypasses the first-visit mobile hero for an invitation continuation', async () => {
        vi.resetModules();
        routeState.params = { returnTo: '/invite/invitation-token?server=https%3A%2F%2Frelay.example.test' };
        const screen = await renderWelcomeScreen();

        expect(screen.findByTestId('unauth-shell-route-welcome')?.props.allowMobileBrandHero).toBe(false);
        expect(await waitForWelcomeTestId(screen, 'welcome-signup-provider')).toBeGreaterThan(0);
        expect(applyBrandHeroSeenSpy).not.toHaveBeenCalled();
    });

    it('shows anonymous primary and provider option when both are enabled', async () => {
        vi.resetModules();
        const { t } = await import('@/text');
        const bothEnabled = createWelcomeFeaturesResponse({
            signupMethods: [
                { id: 'anonymous', enabled: true },
                { id: 'github', enabled: true },
            ],
            requiredProviders: [],
            autoRedirectEnabled: false,
            autoRedirectProviderId: null,
            providerOffboardingIntervalSeconds: 600,
        });
        getServerFeaturesSnapshotMock.mockResolvedValueOnce({ status: 'ready', features: bothEnabled });

        const screen = await renderWelcomeScreen();
        const providerTitle = t('welcome.signUpWithProvider', { provider: 'GitHub' });
        const textContent = await waitForWelcomeText(screen, providerTitle);

        expect(textContent).toContain(providerTitle);
        expect(screen.findAllByTestId('welcome-primary-start').length).toBeGreaterThan(0);
        expect(screen.findAllByTestId('welcome-signup-provider').length).toBeGreaterThan(0);
    });

    it('prefers auth.methods over legacy signup/login methods when present', async () => {
        vi.resetModules();
        const { t } = await import('@/text');

        const authMethods = [
            {
                id: 'key_challenge',
                actions: [
                    { id: 'login' as const, enabled: true, mode: 'keyed' as const },
                    { id: 'provision' as const, enabled: false, mode: 'keyed' as const },
                ],
                ui: { displayName: 'Device key', iconHint: null },
            },
            {
                id: 'github',
                actions: [{ id: 'provision' as const, enabled: true, mode: 'keyed' as const }],
                ui: { displayName: 'GitHub', iconHint: 'github' },
            },
        ] satisfies NonNullable<FeaturesResponse['capabilities']['auth']['methods']>;

        const payload = createWelcomeFeaturesResponse({
            // Legacy says anonymous signup is enabled…
            signupMethods: [
                { id: 'anonymous', enabled: true },
                { id: 'github', enabled: true },
            ],
            // …but auth.methods disables key_challenge provisioning, so anonymous signup must be hidden.
            authMethods,
            requiredProviders: [],
            autoRedirectEnabled: false,
            autoRedirectProviderId: null,
            providerOffboardingIntervalSeconds: 600,
        });
        getServerFeaturesSnapshotMock.mockResolvedValueOnce({ status: 'ready', features: payload });

        const screen = await renderWelcomeScreen();
        const providerTitle = t('welcome.signUpWithProvider', { provider: 'GitHub' });
        const textContent = await waitForWelcomeText(screen, providerTitle);

        expect(textContent).toContain(providerTitle);
        expect(textContent).not.toContain(t('welcome.createAccount'));
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-signup-provider').length).toBeGreaterThan(0);
    });

    it('hides anonymous primary when anonymous signup is disabled and shows provider option', async () => {
        vi.resetModules();
        const { t } = await import('@/text');
        const screen = await renderWelcomeScreen();
        const providerTitle = t('welcome.signUpWithProvider', { provider: 'GitHub' });
        const textContent = await waitForWelcomeText(screen, providerTitle);

        expect(textContent).not.toContain(t('welcome.createAccount'));
        expect(textContent).toContain(providerTitle);
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-signup-provider').length).toBeGreaterThan(0);
    });

    it('hides every signup entry and keeps login when the server disables all signup methods', async () => {
        vi.resetModules();
        // Mirrors a real self-hosted shape (AUTH_ANONYMOUS_SIGNUP_ENABLED=0, no
        // OAuth/mTLS): only key_challenge *login* is enabled, no provision
        // action anywhere. The welcome screen must not offer Create account.
        const loginOnly = createWelcomeFeaturesResponse({
            signupMethods: [{ id: 'anonymous', enabled: false }],
            loginMethods: [{ id: 'key_challenge', enabled: true }],
            authMethods: [
                {
                    id: 'key_challenge',
                    actions: [
                        { id: 'login', enabled: true, mode: 'keyed' },
                        { id: 'provision', enabled: false, mode: 'keyed' },
                    ],
                    ui: { displayName: 'Device key', iconHint: null },
                },
                {
                    id: 'mtls',
                    actions: [
                        { id: 'login', enabled: false, mode: 'keyless' },
                        { id: 'provision', enabled: false, mode: 'keyless' },
                    ],
                    ui: { displayName: 'Certificate', iconHint: null },
                },
                {
                    id: 'github',
                    actions: [
                        { id: 'connect', enabled: false, mode: 'either' },
                        { id: 'provision', enabled: false, mode: 'keyed' },
                        { id: 'login', enabled: false, mode: 'keyless' },
                        { id: 'provision', enabled: false, mode: 'keyless' },
                    ],
                    ui: { displayName: 'GitHub', iconHint: 'github' },
                },
            ],
            requiredProviders: [],
            autoRedirectEnabled: false,
            autoRedirectProviderId: null,
            providerOffboardingIntervalSeconds: 600,
        });
        getServerFeaturesSnapshotMock.mockResolvedValueOnce({ status: 'ready', features: loginOnly });

        const screen = await renderWelcomeScreen();
        expect(await waitForWelcomeTestId(screen, 'welcome-secondary-login')).toBeGreaterThan(0);
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-create-account')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-signup-provider')).toHaveLength(0);
    });

    it('shows mTLS login when signup methods are disabled but mTLS is enabled', async () => {
        vi.resetModules();
        const { t } = await import('@/text');
        const mtlsOnly = createWelcomeFeaturesResponse({
            signupMethods: [{ id: 'anonymous', enabled: false }],
            loginMethods: [{ id: 'mtls', enabled: true }],
            authMtlsEnabled: true,
            requiredProviders: [],
            autoRedirectEnabled: false,
            autoRedirectProviderId: null,
            providerOffboardingIntervalSeconds: 600,
        });
        getServerFeaturesSnapshotMock.mockResolvedValueOnce({ status: 'ready', features: mtlsOnly });

        const screen = await renderWelcomeScreen();
        const mtlsTitle = t('welcome.signInWithCertificate');
        const textContent = await waitForWelcomeText(screen, mtlsTitle);

        expect(textContent).toContain(mtlsTitle);
        expect(textContent).not.toContain(t('welcome.createAccount'));
    });

    it('shows keyless provider login when signup methods are disabled but a keyless OAuth login method is enabled', async () => {
        vi.resetModules();
        const { t } = await import('@/text');
        const keylessOnly = createWelcomeFeaturesResponse({
            signupMethods: [{ id: 'anonymous', enabled: false }],
            loginMethods: [],
            authMethods: [
                {
                    id: 'key_challenge',
                    actions: [
                        { id: 'login', enabled: false, mode: 'keyed' },
                        { id: 'provision', enabled: false, mode: 'keyed' },
                    ],
                    ui: { displayName: 'Device key', iconHint: null },
                },
                {
                    id: 'github',
                    actions: [{ id: 'login', enabled: true, mode: 'keyless' }],
                    ui: { displayName: 'GitHub', iconHint: 'github' },
                },
            ],
            requiredProviders: [],
            autoRedirectEnabled: false,
            autoRedirectProviderId: null,
            providerOffboardingIntervalSeconds: 600,
        });
        getServerFeaturesSnapshotMock.mockResolvedValueOnce({ status: 'ready', features: keylessOnly });

        const screen = await renderWelcomeScreen();
        const providerTitle = t('welcome.signUpWithProvider', { provider: 'GitHub' });
        const textContent = await waitForWelcomeText(screen, providerTitle);

        expect(textContent).toContain(providerTitle);
        expect(textContent).not.toContain(t('welcome.createAccount'));
        expect(screen.findByTestId('welcome-create-account')).not.toBeNull();
    });

    it('shows a server unavailable notice and hides auth actions when the server cannot be reached', async () => {
        vi.resetModules();
        vi.useFakeTimers();
        process.env.EXPO_PUBLIC_HAPPIER_WELCOME_SERVER_CHECK_RETRY_DELAY_MS = '1';
        const { t } = await import('@/text');
        getServerFeaturesSnapshotMock.mockClear();
        getServerFeaturesSnapshotMock
            .mockResolvedValueOnce({ status: 'error', reason: 'network' })
            .mockResolvedValueOnce({ status: 'error', reason: 'network' });

        try {
            const screen = await renderWelcomeScreen();

            expect(screen.findAllByTestId('welcome-server-unavailable')).toHaveLength(0);

            await flushHookEffects({ advanceTimersMs: 1 });
            await waitForWelcomeTestId(screen, 'welcome-server-unavailable');

            expect(getServerFeaturesSnapshotMock).toHaveBeenCalledTimes(2);

            expect(screen.findAllByTestId('welcome-server-unavailable')).toHaveLength(1);
            expect(screen.getTextContent()).toContain(t('welcome.serverUnavailableTitle'));
            expect(screen.findAllByTestId('welcome-secondary-login')).toHaveLength(0);
            expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
            expect(screen.findAllByTestId('welcome-signup-provider')).toHaveLength(0);
            expect(screen.findAllByTestId('welcome-create-account')).toHaveLength(0);
            expect(screen.findByTestId('welcome-retry-server')).not.toBeNull();
            expect(screen.findByTestId('welcome-change-relay')).not.toBeNull();
        } finally {
            delete process.env.EXPO_PUBLIC_HAPPIER_WELCOME_SERVER_CHECK_RETRY_DELAY_MS;
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });

    it('shows a server incompatible notice and hides auth actions when the server features response is invalid', async () => {
        vi.resetModules();
        const { t } = await import('@/text');
        getServerFeaturesSnapshotMock.mockClear();
        getServerFeaturesSnapshotMock.mockResolvedValue({ status: 'unsupported', reason: 'invalid_payload' });

        const screen = await renderWelcomeScreen();

        await waitForWelcomeTestId(screen, 'welcome-server-unavailable');

        expect(getServerFeaturesSnapshotMock).toHaveBeenCalled();
        expect(screen.findAllByTestId('welcome-server-unavailable')).toHaveLength(1);
        expect(screen.getTextContent()).toContain(t('welcome.serverIncompatibleTitle'));
        expect(screen.findAllByTestId('welcome-secondary-login')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-primary-start')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-signup-provider')).toHaveLength(0);
        expect(screen.findAllByTestId('welcome-create-account')).toHaveLength(0);
        expect(screen.findByTestId('welcome-retry-server')).not.toBeNull();
        expect(screen.findByTestId('welcome-change-relay')).not.toBeNull();
    });
});
