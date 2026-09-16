import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import {
    installRestoreScanComputerQrViewCommonModuleMocks,
    resetRestoreScanComputerQrViewCommonModuleMockState,
    restoreScanComputerQrViewModuleState,
} from './restoreScanComputerQrViewTestHelpers';

type ReactActEnvironmentGlobal = typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
};
(globalThis as ReactActEnvironmentGlobal).IS_REACT_ACT_ENVIRONMENT = true;

const navigationState = vi.hoisted(() => ({
    isFocused: true,
}));
const modalAlertSpy = vi.hoisted(() => vi.fn(async () => {}));

installRestoreScanComputerQrViewCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({ spies: { alertAsync: modalAlertSpy } }).module;
    },
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            ScrollView: 'ScrollView',
            ActivityIndicator: 'ActivityIndicator',
            Platform: {
                OS: 'web',
                select: (options: any) => options?.web ?? options?.default ?? options?.ios ?? options?.android,
            },
        });
    },
    reactNavigation: async () => {
        const { createReactNavigationNativeMock } = await import('@/dev/testkit/mocks/reactNavigation');
        return {
            ...createReactNavigationNativeMock(),
            useIsFocused: () => navigationState.isFocused,
        };
    },
});

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: 'enabled' }),
}));

vi.mock('@/utils/platform/platform', () => ({
    isRunningOnMac: () => false,
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ login: vi.fn(async () => {}), refreshFromActiveServer: vi.fn(async () => {}) }),
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerUrl: () => 'https://stack.example.test',
}));

vi.mock('@/sync/api/account/apiPairingAuth', () => ({
    pairingRequest: vi.fn(async () => ({ ok: false, reason: 'not_found', status: 404 })),
}));

vi.mock('@/auth/flows/qrStart', () => ({
    generateAuthKeyPair: () => ({ publicKey: new Uint8Array([1]), secretKey: new Uint8Array([2]) }),
    authQRStart: vi.fn(async () => true),
}));

vi.mock('@/auth/flows/qrWait', () => ({
    authQRWait: vi.fn(async () => null),
}));

vi.mock('@/encryption/base64', () => ({
    encodeBase64: () => 'x',
}));

vi.mock('@/sync/domains/server/activeServerSwitch', () => ({
    normalizeServerUrl: (s: string) => s,
    upsertActivateAndSwitchServer: vi.fn(async () => {}),
}));

let lastScannerProps: any = null;
vi.mock('@/components/qr/QrCodeScannerView', () => ({
    QrCodeScannerView: (props: any) => {
        lastScannerProps = props;
        return React.createElement('div', { 'data-testid': 'QrCodeScannerView' }, props.footer);
    },
}));

describe('RestoreScanComputerQrView (web phone)', () => {
    beforeEach(() => {
        vi.resetModules();
        resetRestoreScanComputerQrViewCommonModuleMockState();
        navigationState.isFocused = true;
        lastScannerProps = null;
        modalAlertSpy.mockClear();
    });

    it('preserves the invitation in scanner alternatives and after pairing approval', async () => {
        const returnTo = '/invite/mobile?server=https%3A%2F%2Frelay.example';
        restoreScanComputerQrViewModuleState.routeParams = { returnTo };
        const { pairingRequest } = await import('@/sync/api/account/apiPairingAuth');
        const { authQRWait } = await import('@/auth/flows/qrWait');
        vi.mocked(pairingRequest).mockResolvedValue({ ok: true, data: { state: 'requested', confirmCode: '123456' } });
        vi.mocked(authQRWait).mockResolvedValue({ token: 'token', secret: new Uint8Array(32) });
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');
        const screen = await renderScreen(<RestoreScanComputerQrView />);
        await act(async () => { await screen.findByTestId('restore-open-manual')?.props.action(); });
        await act(async () => { await screen.findByTestId('restore-show-qr-instead')?.props.action(); });
        for (const route of ['/restore/manual', '/restore/show-qr']) {
            expect.soft(restoreScanComputerQrViewModuleState.routerPushSpy).toHaveBeenCalledWith(`${route}?returnTo=${encodeURIComponent(returnTo)}`);
        }
        await act(async () => {
            await lastScannerProps.onScan('happier:///pair?v=1&pairId=pair_123&secret=secret_123');
        });
        expect(restoreScanComputerQrViewModuleState.routerReplaceSpy).toHaveBeenCalledWith(returnTo);
    });

    it('renders the QR scanner in idle state on web', async () => {
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        const screen = await renderScreen(<RestoreScanComputerQrView />);

        expect(screen.findByProps({ 'data-testid': 'QrCodeScannerView' })).toBeTruthy();
        expect(lastScannerProps?.testIDPrefix).toBe('restore-scan');
        expect(lastScannerProps?.active).toBe(true);
    });

    it('marks the QR scanner inactive when the restore route is covered by another screen', async () => {
        navigationState.isFocused = false;

        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);

        expect(lastScannerProps?.active).toBe(false);
    });

    it('explains that an account-connect QR must be scanned from a signed-in device', async () => {
        const { RestoreScanComputerQrView } = await import('./RestoreScanComputerQrView');

        await renderScreen(<RestoreScanComputerQrView />);

        await act(async () => {
            await lastScannerProps?.onScan('happier:///account?abc123');
        });

        expect(modalAlertSpy).toHaveBeenCalledWith(
            'connect.restoreAccount',
            'connect.restoreQrInstructions',
            expect.any(Array),
        );
        expect(modalAlertSpy).not.toHaveBeenCalledWith('common.error', 'modals.invalidAuthUrl');
    });
});
