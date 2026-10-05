import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storage';

import { RemoteWelcomeDecisionPanel } from './RemoteWelcomeDecisionPanel';
import { deriveRemoteAuthEntryOptions, type RemoteAuthEntryOptionsInput } from './useRemoteAuthEntryOptions';

const deviceState = vi.hoisted(() => ({
    width: 390,
    height: 844,
}));

vi.mock('react-native', async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
        useWindowDimensions: () => ({
            width: deviceState.width,
            height: deviceState.height,
            scale: 3,
            fontScale: 1,
        }),
    });
});

vi.mock('react-native-unistyles', async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
});

const noop = () => {};

function createInput(): RemoteAuthEntryOptionsInput {
    return {
        serverAvailability: 'ready',
        serverUrlForCopy: 'https://relay.example.test',
        retryServerCheck: noop,
        signupOptions: {
            anonymousEnabled: true,
            providerIds: Object.freeze([]),
            preferredProviderId: null,
        },
        loginOptions: {
            mtlsEnabled: false,
            keylessProviderIds: Object.freeze([]),
            preferredKeylessProviderId: null,
        },
        providerDisplayNameById: (providerId) => providerId,
        hasPendingTerminalConnect: false,
        hasPendingSetupIntent: false,
    };
}

function renderPanel(onChangeRelay = noop, onRestore = noop) {
    return renderScreen(
        <RemoteWelcomeDecisionPanel
            options={deriveRemoteAuthEntryOptions(createInput())}
            isDesktopShell={false}
            layout="portrait"
            onAnonymousSignup={noop}
            onChangeRelay={onChangeRelay}
            onKeylessProviderLogin={noop}
            onMtlsLogin={noop}
            onOpenSetup={noop}
            onProviderSignup={noop}
            onRestore={onRestore}
        />,
    );
}

describe('RemoteWelcomeDecisionPanel mobile wordmark', () => {
    beforeEach(() => {
        standardCleanup();
        storage.setState({ localSettings: { ...storage.getState().localSettings, hasCompletedAuthOnce: false } });
        deviceState.width = 390;
        deviceState.height = 844;
    });

    it('leaves the mobile wordmark to the workflow pane', async () => {
        const screen = await renderPanel();

        expect(screen.findAllByTestId('welcome-mobile-wordmark')).toHaveLength(0);
        expect(screen.findAllByTestId('brand-wordmark')).toHaveLength(0);
    });

    it('does not duplicate the wordmark inside the desktop workflow pane', async () => {
        deviceState.width = 900;
        const screen = await renderPanel();

        expect(screen.findAllByTestId('welcome-mobile-wordmark')).toHaveLength(0);
    });

    it('orients first visits before offering recovery as an alternative', async () => {
        const screen = await renderPanel();
        expect(screen.findByTestId('welcome-private-key-copy')).not.toBeNull();
        const actions = screen.root.findAll(node => node.props.testID === 'welcome-primary-start' || node.props.testID === 'welcome-secondary-login');
        expect(actions[0].props.testID).toBe('welcome-primary-start');
    });

    it('takes returning visitors directly to account recovery without first-run copy', async () => {
        storage.setState({ localSettings: { ...storage.getState().localSettings, hasCompletedAuthOnce: true } });
        const onRestore = vi.fn();
        const screen = await renderPanel(noop, onRestore);
        expect(screen.findByTestId('welcome-private-key-copy')).toBeNull();
        const actions = screen.root.findAll(node => node.props.testID === 'welcome-primary-start' || node.props.testID === 'welcome-secondary-login');
        expect(actions[0].props.testID).toBe('welcome-secondary-login');
        screen.pressByTestId('welcome-secondary-login');
        expect(onRestore).toHaveBeenCalledTimes(1);
    });

    it('offers the real relay selector when the server is unavailable', async () => {
        const onChangeRelay = vi.fn();
        const input = { ...createInput(), serverAvailability: 'unavailable' as const };
        const screen = await renderScreen(<RemoteWelcomeDecisionPanel
            options={deriveRemoteAuthEntryOptions(input)} isDesktopShell={false} layout="portrait"
            onAnonymousSignup={noop} onChangeRelay={onChangeRelay} onKeylessProviderLogin={noop}
            onMtlsLogin={noop} onOpenSetup={noop} onProviderSignup={noop} onRestore={noop} />);
        screen.pressByTestId('welcome-change-relay');
        expect(onChangeRelay).toHaveBeenCalledTimes(1);
    });
});
