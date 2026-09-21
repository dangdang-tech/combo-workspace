import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { storage } from '@/sync/domains/state/storageStore';
import { profileDefaults } from '@/sync/domains/profiles/profile';
import { formatSecretKeyForBackup } from '@/auth/recovery/secretKeyBackup';
import {
    renderScreen,
    renderSettingsView,
    standardCleanup,
} from '@/dev/testkit';
import { createAccountFeaturesResponse, getRequestUrl, isFeaturesRequest } from './account.testHelpers';
import { installAccountSettingsRouteModuleMocks } from './accountSettingsRouteTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native-reanimated', () => ({}));

vi.mock('expo-camera', () => ({
    useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })],
    CameraView: {
        isModernBarcodeScannerAvailable: false,
        onModernBarcodeScanned: () => ({ remove: () => {} }),
        launchScanner: () => {},
        dismissScanner: async () => {},
    },
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({
        isAuthenticated: true,
        credentials: { token: 't', secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
        logout: vi.fn(),
    }),
}));

const routeParams = vi.hoisted(() => ({ returnTo: undefined as string | string[] | undefined }));

const clipboardMocks = vi.hoisted(() => ({
    setStringAsync: vi.fn(async () => {}),
}));
vi.mock('expo-clipboard', () => clipboardMocks);

const modalMocks = vi.hoisted(() => ({
    show: vi.fn(),
    alert: vi.fn(),
    prompt: vi.fn(),
    confirm: vi.fn(),
}));

installAccountSettingsRouteModuleMocks({
    routerModule: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ params: () => routeParams }).module;
    },
    modalModule: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: modalMocks,
        }).module;
    },
});

describe('Settings → Account (secret key copy)', () => {
    afterEach(() => {
        routeParams.returnTo = undefined;
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        standardCleanup();
    });

    it.each([
        ['/invite/valid-token?server=https%3A%2F%2Frelay.example', '/invite/valid-token?server=https%3A%2F%2Frelay.example'],
        [undefined, '/settings/account'],
        ['https://external.example', '/settings/account'],
        ['//external.example', '/settings/account'],
        [['/invite/one', '/invite/two'], '/settings/account'],
    ])('passes only a validated return route from %s to account linking', async (returnTo, expected) => {
        routeParams.returnTo = returnTo;
        storage.getState().applyProfile({ ...profileDefaults, linkedProviders: [], username: null });
        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = getRequestUrl(input);
            if (isFeaturesRequest(url)) return { ok: true, json: async () => createAccountFeaturesResponse() };
            throw new Error(`Unexpected fetch: ${url}`);
        }));
        const { default: AccountScreen } = await import('@/app/(app)/settings/account');
        const { ProviderIdentityItems } = await import('@/components/account/ProviderIdentityItems');
        const screen = await renderScreen(<AccountScreen />);
        const identityComponent = 'type' in ProviderIdentityItems ? ProviderIdentityItems.type : ProviderIdentityItems;
        expect(screen.findByType(identityComponent).props.returnTo).toBe(expected);
    });

    it('keeps account recovery available without analytics or crash report controls', async () => {
        storage.getState().applyProfile({ ...profileDefaults, linkedProviders: [], username: null });

        vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
            const url = getRequestUrl(input);
            if (isFeaturesRequest(url)) {
                return { ok: true, json: async () => createAccountFeaturesResponse() };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        }));

        const { default: AccountScreen } = await import('@/app/(app)/settings/account');
        const screen = await renderSettingsView(<AccountScreen />);

        expect(screen.findByTestId('settings-account-secret-key-copy')).toBeTruthy();
        expect(screen.findByTestId('settings-account-logout')).toBeTruthy();
        expect(screen.findGroup('settingsAccount.privacy')).toBeNull();
        expect(screen.findRowByTitle('settingsAccount.analytics')).toBeNull();
        expect(screen.findRowByTitle('settingsAccount.crashReports')).toBeNull();
        expect(screen.findByTestId('settings-account-analytics-switch')).toBeNull();
        expect(screen.findByTestId('settings-account-crash-reports-switch')).toBeNull();
    });

    it('allows copying the secret key without revealing it', async () => {
        storage.getState().applyProfile({ ...profileDefaults, linkedProviders: [], username: null });

        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = getRequestUrl(input);
            if (isFeaturesRequest(url)) {
                return {
                    ok: true,
                    json: async () => createAccountFeaturesResponse(),
                };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

        clipboardMocks.setStringAsync.mockClear();
        modalMocks.alert.mockClear();

        const { default: AccountScreen } = await import('@/app/(app)/settings/account');
        const screen = await renderScreen(<AccountScreen />);
        const secretKeyItem = screen.findByTestId('settings-account-secret-key-item');
        const copyButton = screen.findByTestId('settings-account-secret-key-copy');

        expect(secretKeyItem).toBeTruthy();
        expect(copyButton).toBeTruthy();

        await screen.pressByTestIdAsync('settings-account-secret-key-copy');

        const expected = formatSecretKeyForBackup('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
        expect(clipboardMocks.setStringAsync).toHaveBeenCalledWith(expected);
        expect(modalMocks.alert).not.toHaveBeenCalledWith('common.success', 'settingsAccount.secretKeyCopied');
        expect(screen.findByTestId('settings-account-secret-key-copy-copied')).toBeTruthy();
    });
});
