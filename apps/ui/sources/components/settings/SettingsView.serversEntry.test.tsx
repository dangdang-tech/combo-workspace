import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    renderSettingsView,
    standardCleanup,
} from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from './settingsViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const shared = vi.hoisted(() => ({
    routerPushSpy: vi.fn(),
    routerBackSpy: vi.fn(),
    routerReplaceSpy: vi.fn(),
    navigateWithBlurOnWebSpy: vi.fn((action: () => void) => action()),
    deferOnWebSpy: vi.fn((action: () => void) => action()),
    linkingCanOpenURLSpy: vi.fn(async () => false),
    linkingOpenURLSpy: vi.fn(async () => {}),
    requestReviewSpy: vi.fn(),
    canRequestReviewSpy: vi.fn(async () => true),
}));

const settingsViewWebDimensions = { width: 1600, height: 900, scale: 2, fontScale: 1 };

function createPassthroughNode(name: string) {
    return (props: any) => React.createElement(name, props, props.children);
}

function createPropPassthroughNode(name: string) {
    return (props: any) => React.createElement(name, props);
}

function createSettingsViewStorageOverrides() {
    return {
        useEntitlement: () => false,
        // Boundary mock: this suite only reads a boolean local setting toggle.
        useLocalSettingMutable: (() => [false, vi.fn()]) as any,
        useSetting: (key: string) => {
            if (key === 'serverSelectionGroups') return [];
            if (key === 'serverSelectionActiveTargetKind') return null;
            if (key === 'serverSelectionActiveTargetId') return null;
            if (key === 'experiments') return false;
            if (key === 'featureToggles') return {};
            if (key === 'useProfiles') return false;
            if (key === 'sessionUseTmux') return false;
            return null;
        },
        useAllMachines: () => [],
        useMachineListByServerId: () => ({}),
        useMachineListStatusByServerId: () => ({}),
        // Boundary mock: SettingsView only consumes these profile fields in this suite.
        useProfile: (() => ({ id: 'prof_1', firstName: '', connectedServices: [] })) as any,
    };
}

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            ActivityIndicator: 'ActivityIndicator',
            Dimensions: {
                get: () => settingsViewWebDimensions,
            },
            useWindowDimensions: () => settingsViewWebDimensions,
            Linking: { canOpenURL: shared.linkingCanOpenURLSpy, openURL: shared.linkingOpenURLSpy },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({
            router: {
                push: shared.routerPushSpy,
                back: shared.routerBackSpy,
                replace: shared.routerReplaceSpy,
                setParams: vi.fn(),
            },
        }).module;
    },
    storage: async (importOriginal) => {
        const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleMock({
            importOriginal,
            overrides: createSettingsViewStorageOverrides(),
        });
    },
});

vi.mock('expo-image', () => ({
    Image: 'Image',
}));

vi.mock('@/utils/platform/navigateWithBlurOnWeb', () => ({
    navigateWithBlurOnWeb: (action: () => void) => shared.navigateWithBlurOnWebSpy(action),
}));

vi.mock('@/utils/platform/deferOnWeb', () => ({
    deferOnWeb: (action: () => void) => shared.deferOnWebSpy(action),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@react-navigation/native', () => ({
    useFocusEffect: (_cb: () => void) => {},
}));

vi.mock('expo-constants', () => ({
    default: { expoConfig: { version: '0.0.0-test' } },
}));

vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: createPassthroughNode('ItemList'),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: createPassthroughNode('ItemGroup'),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: createPropPassthroughNode('Item'),
}));

vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: () => ({ connectTerminal: vi.fn(), connectWithUrl: vi.fn(), isLoading: false }),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ credentials: null }),
}));

vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
    const { createStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleMock({
        importOriginal,
        overrides: createSettingsViewStorageOverrides(),
    });
});

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshMachinesThrottled: vi.fn(async () => {}),
        presentPaywall: vi.fn(async () => ({ success: false, error: 'nope' })),
        refreshProfile: vi.fn(async () => {}),
    },
}));

vi.mock('@/track', () => ({
    trackPaywallButtonClicked: vi.fn(),
    trackWhatsNewClicked: vi.fn(),
}));

vi.mock('@/hooks/ui/useMultiClick', () => ({
    useMultiClick: (cb: () => void) => cb,
}));

vi.mock('@/utils/sessions/machineUtils', () => ({
    isMachineOnline: () => false,
}));

vi.mock('@/components/ui/layout/layout', () => ({
    layout: { maxWidth: 1000 },
}));

vi.mock('@/hooks/ui/useHappyAction', () => ({
    useHappyAction: (fn: any) => [false, fn],
}));

vi.mock('@/sync/api/account/apiVendorTokens', () => ({
    disconnectVendorToken: vi.fn(async () => {}),
}));

vi.mock('@/sync/domains/profiles/profile', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/domains/profiles/profile')>();
    return {
        ...actual,
        getDisplayName: () => 'Test User',
        getAvatarUrl: () => null,
        getBio: () => '',
    };
});

vi.mock('@/components/ui/avatar/Avatar', () => ({
    Avatar: 'Avatar',
}));

vi.mock('@/components/sessions/new/components/MachineCliGlyphs', () => ({
    MachineCliGlyphs: 'MachineCliGlyphs',
}));

vi.mock('@/agents/catalog/catalog', () => ({
    AGENT_IDS: ['codex', 'claude', 'gemini'],
    DEFAULT_AGENT_ID: 'agent_default',
    getAgentCore: () => ({ uiConnectedService: { serviceId: 'anthropic', label: 'Anthropic', connectRoute: null } }),
    getAgentIconSource: () => null,
    getAgentIconTintColor: () => null,
    resolveAgentIdFromConnectedServiceId: () => null,
}));

vi.mock('@/components/settings/supportUsBehavior', () => ({
    resolveSupportUsAction: () => 'github',
}));

vi.mock('@/utils/system/bugReportActionTrail', () => ({
    recordBugReportUserAction: vi.fn(),
}));

vi.mock('@/hooks/server/useAutomationsSupport', () => ({
    useAutomationsSupport: () => ({ enabled: false }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => null,
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getActiveServerSnapshot: () => ({ serverId: 'server-1', serverUrl: 'https://local.example.test', generation: 0 }),
    listServerProfiles: () => [],
    subscribeActiveServer: (listener: any) => {
        listener({ serverId: 'server-1', serverUrl: 'https://local.example.test', generation: 0 });
        return () => {};
    },
}));

vi.mock('@/utils/system/requestReview', () => ({
    requestReview: shared.requestReviewSpy,
    canRequestReview: shared.canRequestReviewSpy,
}));

afterEach(() => {
    vi.useRealTimers();
    standardCleanup();
    shared.routerPushSpy.mockClear();
    shared.routerBackSpy.mockClear();
    shared.routerReplaceSpy.mockClear();
    shared.navigateWithBlurOnWebSpy.mockClear();
    shared.deferOnWebSpy.mockClear();
    shared.linkingCanOpenURLSpy.mockClear();
    shared.linkingOpenURLSpy.mockClear();
    shared.requestReviewSpy.mockClear();
    shared.canRequestReviewSpy.mockReset();
    shared.canRequestReviewSpy.mockResolvedValue(true);
});

describe('SettingsView', () => {
    async function renderSettingsViewUnderTest() {
        vi.useFakeTimers();
        const { SettingsView } = await import('./SettingsView');
        const screen = await renderSettingsView(
            React.createElement(SettingsView),
            { flushOptions: { runAllTimers: true, cycles: 8 } },
        );
        for (let index = 0; index < 8; index += 1) {
            await act(async () => {
                await vi.runOnlyPendingTimersAsync();
            });
        }
        return screen;
    }

    it('keeps only account recovery and machine management as settings destinations', async () => {
        const screen = await renderSettingsViewUnderTest();
        const destinations = screen.tree.findAllByType('Item' as any)
            .filter((item) => typeof item.props.onPress === 'function')
            .map((item) => item.props.title);

        expect(destinations).toEqual(['settings.account', 'settings.machines']);
    });

    it('opens the existing account page for identities and recovery keys', async () => {
        const screen = await renderSettingsViewUnderTest();

        await screen.pressRowByTitle('settings.account');

        expect(shared.routerPushSpy).toHaveBeenCalledWith('/settings/account');
    });

    it('blurs the active element before routing to Machines on web', async () => {
        const screen = await renderSettingsViewUnderTest();

        await screen.pressRowByTitle('settings.machines');

        expect(shared.deferOnWebSpy).toHaveBeenCalledTimes(1);
        expect(shared.navigateWithBlurOnWebSpy).toHaveBeenCalledTimes(1);
        expect(shared.routerPushSpy).toHaveBeenCalledWith('/settings/machines');
    });

    it('shows the current server address without offering relay management', async () => {
        const screen = await renderSettingsViewUnderTest();
        const server = screen.findRowByTitle('systemStatus.sections.currentServer');

        expect(server?.props.subtitle).toBe('https://local.example.test');
        expect(server?.props.onPress).toBeUndefined();
        expect(server?.props.showChevron).toBe(false);
        expect(screen.findRowByTitle('settings.servers')).toBeNull();
    });
});
