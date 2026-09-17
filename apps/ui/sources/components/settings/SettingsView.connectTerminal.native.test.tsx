import * as React from 'react';
import { act, ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { renderScreen } from '@/dev/testkit';
import { installSettingsViewCommonModuleMocks } from './settingsViewTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const connectTerminalSpy = vi.fn();
const processAuthUrlSpy = vi.fn(async (_url: string) => true);
const promptSpy = vi.fn(async (..._args: unknown[]) => null as string | null);
const requestReviewMockState = vi.hoisted(() => ({
    canRequestReview: vi.fn(async () => false),
    requestReview: vi.fn(async () => {}),
}));
const interactionManagerMockState = vi.hoisted(() => ({
    runAfterInteractions: vi.fn((fn: () => void) => {
        fn();
        return { cancel: () => {} };
    }),
}));

installSettingsViewCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Pressable: 'Pressable',
            Dimensions: {
                get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
            },
            useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
            Platform: {
                OS: 'ios',
                select: (options: any) => (options && 'default' in options ? options.default : undefined),
            },
            Text: 'Text',
            ActivityIndicator: 'ActivityIndicator',
            InteractionManager: {
                runAfterInteractions: interactionManagerMockState.runAfterInteractions,
            },
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: { push: vi.fn() },
        });
        return routerMock.module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: vi.fn(),
                confirm: vi.fn(async () => false),
                prompt: (...args: unknown[]) => promptSpy(...args),
            },
        }).module;
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useEntitlement: () => false,
            useLocalSettingMutable: () => [false, vi.fn()],
            useSetting: () => null,
            useAllMachines: () => [],
            useMachineListByServerId: () => ({}),
            useMachineListStatusByServerId: () => ({}),
            useProfile: () => ({ id: 'prof_1', firstName: '', connectedServices: [] }),
        });
    },
});

vi.mock('expo-image', () => ({
    Image: 'Image',
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'StyledText',
    TextInput: 'TextInput',
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
    ItemList: ({ children }: any) => React.createElement('ItemList', null, children),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: ({ children }: any) => React.createElement('ItemGroup', null, children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', props),
}));

vi.mock('@/hooks/session/useConnectTerminal', () => ({
    useConnectTerminal: () => ({ connectTerminal: connectTerminalSpy, connectWithUrl: vi.fn(), isLoading: false }),
}));

vi.mock('@/hooks/auth/useScannedAuthUrlProcessor', () => ({
    useScannedAuthUrlProcessor: () => ({ processAuthUrl: processAuthUrlSpy, isLoading: false }),
}));

vi.mock('@/auth/context/AuthContext', () => ({
    useAuth: () => ({ credentials: null }),
}));

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

vi.mock('@/utils/system/requestReview', () => ({
    canRequestReview: requestReviewMockState.canRequestReview,
    requestReview: requestReviewMockState.requestReview,
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

function findItemByTitle(tree: ReactTestRenderer, title: string) {
    return tree.findAllByType('Item' as any).find((item: any) => item?.props?.title === title);
}

describe('SettingsView (native core sharing settings)', () => {
    it('keeps account and machine access available without duplicate device pairing actions', async () => {
        vi.resetModules();
        const { SettingsView } = await import('./SettingsView');
        const screen = await renderScreen(<SettingsView />);
        const items = screen.tree.findAllByType('Item' as any);

        expect(items.find((item) => item.props.testID === 'settings-connect-terminal-scan')).toBeUndefined();
        expect(items.find((item) => item.props.testID === 'settings-connect-terminal-enter-url')).toBeUndefined();
        expect(findItemByTitle(screen.tree, 'settings.account')).toBeTruthy();
        expect(findItemByTitle(screen.tree, 'settings.machines')).toBeTruthy();
    });

    it('renders core settings immediately and does not add optional sections after interactions', async () => {
        interactionManagerMockState.runAfterInteractions.mockClear();
        requestReviewMockState.canRequestReview.mockClear();
        vi.resetModules();
        const { SettingsView } = await import('./SettingsView');
        vi.useFakeTimers();
        try {
            const screen = await renderScreen(<SettingsView />, { flushOptions: { cycles: 0 } });
            const destinations = () => screen.tree.findAllByType('Item' as any)
                .filter((item) => typeof item.props.onPress === 'function')
                .map((item) => item.props.title);

            expect(destinations()).toEqual(['settings.account', 'settings.machines']);
            await act(async () => { await vi.runAllTimersAsync(); });
            expect(destinations()).toEqual(['settings.account', 'settings.machines']);
            expect(requestReviewMockState.canRequestReview).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
