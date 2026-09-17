import React from 'react';
import { Pressable, View } from 'react-native';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findTestInstanceByTypeContainingText, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installNavigationShellCommonModuleMocks } from './navigationShellTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerPushSpy = vi.hoisted(() => vi.fn());

const automationsSupportState = vi.hoisted(() => ({
    enabled: true,
}));

const friendRequestsState = vi.hoisted(() => ({
    items: [] as Array<{ id: string }>,
}));

const inboxState = vi.hoisted(() => ({
    hasContent: false,
}));

const socketStatusState = vi.hoisted(() => ({
    status: 'connected' as 'connected' | 'connecting' | 'disconnected' | 'error',
    lastError: null as string | null,
}));

const syncErrorState = vi.hoisted(() => ({
    value: null as null | { message: string; retryable?: boolean; kind?: string; at?: number },
}));

installNavigationShellCommonModuleMocks({
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                alert: vi.fn(),
                confirm: vi.fn(),
                prompt: vi.fn(),
            },
        }).module;
    },
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'ios',
            },
            View: 'View',
            Text: 'Text',
            Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
            useWindowDimensions: () => ({ width: 1200, height: 800 }),
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const routerMock = createExpoRouterMock({
            router: { push: routerPushSpy },
        });
        return routerMock.module;
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/mocks/storage');
        return createPartialStorageModuleMock(importOriginal, {
            useSocketStatus: () => ({ status: socketStatusState.status, lastError: socketStatusState.lastError }),
            useFriendRequests: () => friendRequestsState.items,
            useSetting: () => false,
            useSyncError: () => syncErrorState.value as any,
            useRealtimeStatus: () => 'disconnected',
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                dark: false,
                colors: {
                    header: { tint: '#111' },
                    groupped: { background: '#fff' },
                    divider: '#ddd',
                    surface: '#fff',
                    shadow: { color: '#000' },
                    text: '#111',
                    textSecondary: '#777',
                    fab: { background: '#000' },
                    status: { error: '#f00' },
                },
            },
        });
    },
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    Octicons: 'Octicons',
}));

vi.mock('expo-image', () => ({
    Image: 'Image',
}));

vi.mock('./MainView', () => ({
    MainView: () => null,
}));

vi.mock('@/components/navigation/ConnectionStatusControl', () => ({
    ConnectionStatusControl: () => null,
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        retryNow: vi.fn(),
    },
}));

vi.mock('@/components/ui/lists/ItemRowActions', () => ({
    ItemRowActions: (props: any) => {
        const layoutWidthPx = typeof props.layoutWidthPx === 'number' ? props.layoutWidthPx : null;
        const compactThreshold = typeof props.compactThreshold === 'number' ? props.compactThreshold : null;
        const pinnedIds = new Set<string>(Array.isArray(props.pinnedActionIds) ? props.pinnedActionIds : []);
        const isCompact = Boolean(layoutWidthPx !== null && compactThreshold !== null && layoutWidthPx < compactThreshold);

        const actionList = Array.isArray(props.actions) ? props.actions : [];
        const inlineActions = isCompact ? actionList.filter((action: any) => pinnedIds.has(action.id)) : actionList;
        const overflowActions = isCompact ? actionList.filter((action: any) => !pinnedIds.has(action.id)) : [];

        return React.createElement(
            View,
            null,
            overflowActions.length > 0
                ? React.createElement(
                    Pressable,
                    {
                        key: 'overflow',
                        testID: props.overflowTriggerTestID,
                        accessibilityLabel: 'sidebar-header-actions-overflow',
                        onPress: vi.fn(),
                    },
                    null,
                )
                : null,
            inlineActions.map((action: any) =>
                React.createElement(
                    Pressable,
                    {
                        key: action.id,
                        testID: action.inlineTestID,
                        accessibilityLabel: action.title,
                        onPress: action.onPress,
                    },
                    action.icon ?? null,
                ),
            ),
        );
    },
}));

vi.mock('@/utils/platform/responsive', () => ({
    useHeaderHeight: () => 56,
}));

vi.mock('@/hooks/inbox/useInboxHasContent', () => ({
    useInboxHasContent: () => inboxState.hasContent,
}));

vi.mock('@/hooks/server/useFriendsEnabled', () => ({
    useFriendsEnabled: () => true,
}));

vi.mock('@/hooks/server/useAutomationsSupport', () => ({
    useAutomationsSupport: () => ({ enabled: automationsSupportState.enabled }),
}));

const featureEnabledState: Record<string, boolean> = {
    voice: false,
    'inbox.global': true,
    'actions.approvals': false,
};

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureEnabledState[featureId] === true,
}));

vi.mock('@/sync/runtime/appVariant', () => ({
    resolveVisibleAppEnvironmentBadge: () => null,
}));

vi.mock('@/config', () => ({
    config: { variant: 'prod' },
}));

vi.mock('@/sync/domains/server/serverContext', () => ({
    isStackContext: () => false,
}));

vi.mock('@/sync/domains/server/serverConfig', () => ({
    isUsingCustomServer: () => false,
}));

vi.mock('@/components/ui/status/StatusDot', () => ({
    StatusDot: 'StatusDot',
}));

vi.mock('@/components/ui/buttons/FABWide', () => ({
    FABWide: (props: any) => React.createElement('FABWide', props),
}));

vi.mock('@/components/voice/surface/VoiceSurface', () => ({
    VoiceSurface: 'VoiceSurface',
}));

vi.mock('@/components/ui/popover', () => ({
    PopoverBoundaryProvider: ({ children }: any) => React.createElement('PopoverBoundaryProvider', null, children),
    PopoverScope: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/navigation/ConnectionStatusControl', () => ({
    ConnectionStatusControl: 'ConnectionStatusControl',
}));

vi.mock('./MainView', () => ({
    MainView: 'MainView',
}));

function flattenStyle(style: unknown) {
    if (Array.isArray(style)) {
        return style.reduce<Record<string, unknown>>((acc, item) => {
            if (item && typeof item === 'object') {
                Object.assign(acc, item as Record<string, unknown>);
            }
            return acc;
        }, {});
    }
    return style ?? {};
}

describe('SidebarView header automations button', () => {
    beforeEach(() => {
        routerPushSpy.mockReset();
        automationsSupportState.enabled = true;
        featureEnabledState.voice = false;
        friendRequestsState.items = [];
        inboxState.hasContent = false;
        socketStatusState.status = 'connected';
        socketStatusState.lastError = null;
        syncErrorState.value = null;
    });

    it('navigates to home when logo is pressed', async () => {
        const { SidebarView } = await import('./SidebarView');

        const screen = await renderScreen(<SidebarView />);
        const button = screen.findByProps({ accessibilityLabel: 'common.home' });
        expect(button.props.accessibilityRole).toBe('button');
        await act(async () => {
            await pressTestInstanceAsync(button);
        });

        expect(routerPushSpy).toHaveBeenCalledWith('/');
    });

    it('blocks shell navigation when an unsaved-changes guard is active and the user keeps editing', async () => {
        const { setActiveUnsavedChangesGuard, clearActiveUnsavedChangesGuard } = await import('@/utils/navigation/runGuardedNavigation');

        const isDirtyRef = { current: true };
        setActiveUnsavedChangesGuard({
            isDirtyRef,
            requestDecision: async () => 'keepEditing',
            tag: 'SidebarView.keepEditing',
        });

        const { SidebarView } = await import('./SidebarView');

        const screen = await renderScreen(<SidebarView />);
        const button = screen.findByProps({ accessibilityLabel: 'common.home' });
        await act(async () => {
            await pressTestInstanceAsync(button);
        });

        expect(routerPushSpy).not.toHaveBeenCalled();

        clearActiveUnsavedChangesGuard();
    });

    it('does not render automations button in header', async () => {
        const { SidebarView } = await import('./SidebarView');
        const screen = await renderScreen(<SidebarView />);

        expect(() => screen.findByProps({ accessibilityLabel: 'automations.openA11y' })).toThrow();
    });

    it('does not render the wide FAB button in the sidebar', async () => {
        const { SidebarView } = await import('./SidebarView');
        const screen = await renderScreen(<SidebarView />);

        expect(screen.findAllByType('FABWide')).toHaveLength(0);
    });

    it('does not render VoiceSurface when voice is disabled', async () => {
        const { SidebarView } = await import('./SidebarView');
        const screen = await renderScreen(<SidebarView />);

        expect(screen.findAllByType('VoiceSurface')).toHaveLength(0);
    });

    it('keeps VoiceSurface absent even when voice is enabled', async () => {
        featureEnabledState.voice = true;
        const { SidebarView } = await import('./SidebarView');
        const screen = await renderScreen(<SidebarView />);

        expect(screen.findAllByType('VoiceSurface')).toHaveLength(0);
    });

    it('keeps social and activity entry points absent when their data is available', async () => {
        friendRequestsState.items = [{ id: 'fr-1' }, { id: 'fr-2' }];
        inboxState.hasContent = true;
        const { SidebarView } = await import('./SidebarView');
        const screen = await renderScreen(<SidebarView />);

        expect(screen.findByTestId('sidebar-inbox-button')).toBeNull();
        expect(screen.findByTestId('desktop-sidebar-action-operations')).toBeNull();
        expect(screen.findAllByProps({ accessibilityLabel: 'tabs.friends' })).toHaveLength(0);
    });

    it('constrains the server status row to the shrinking title column before the header icons', async () => {
        const { SidebarView } = await import('./SidebarView');

        const screen = await renderScreen(<SidebarView />);
        const control = screen.findByType('ConnectionStatusControl' as any);
        expect(control.props.variant).toBe('sidebar');

        const wrapper = control.parent;
        expect(flattenStyle(wrapper?.props.style)).toMatchObject({
            alignSelf: 'stretch',
            flexShrink: 1,
            maxWidth: '100%',
            minWidth: 0,
        });
    });

    it('does not surface raw socket errors in a sidebar banner above the session list', async () => {
        socketStatusState.status = 'error';
        socketStatusState.lastError = 'xhr poll error';

        const { SidebarView } = await import('./SidebarView');
        const screen = await renderScreen(<SidebarView sidebarWidthPx={600} />);

        expect(findTestInstanceByTypeContainingText(screen.tree, 'Text', 'xhr poll error')).toBeUndefined();
        expect(findTestInstanceByTypeContainingText(screen.tree, 'Text', 'status.error')).toBeUndefined();
    });

    it('does not render a separate retry banner above the session list when connection errors occur', async () => {
        syncErrorState.value = { message: 'xhr poll error', retryable: true, kind: 'unknown', at: Date.now() };

        const { SidebarView } = await import('./SidebarView');
        const screen = await renderScreen(<SidebarView sidebarWidthPx={600} />);

        expect(findTestInstanceByTypeContainingText(screen.tree, 'Text', 'common.retry')).toBeUndefined();
    });

    it('shows the header icons inline when the sidebar is wide enough', async () => {
        const { SidebarView } = await import('./SidebarView');

        const screen = await renderScreen(<SidebarView sidebarWidthPx={600} />);

        expect(screen.findAllByTestId('sidebar-header-actions-overflow')).toHaveLength(0);
        expect(screen.findAllByTestId('sidebar-inbox-button')).toHaveLength(0);
        expect(screen.findAllByTestId('nav-settings').length).toBeGreaterThan(0);
        expect(screen.findAllByTestId('nav-new-session').length).toBeGreaterThan(0);
    });

    it('keeps settings and new session directly available on narrow sidebars without extra navigation', async () => {
        const { SidebarView } = await import('./SidebarView');
        const screen = await renderScreen(<SidebarView sidebarWidthPx={250} />);

        expect(screen.findAllByTestId('sidebar-header-actions-overflow')).toHaveLength(0);
        expect(screen.findAllByTestId('sidebar-inbox-button')).toHaveLength(0);
        expect(screen.findAllByTestId('nav-settings').length).toBeGreaterThan(0);
        expect(screen.findAllByTestId('nav-new-session').length).toBeGreaterThan(0);
        await act(async () => {
            await pressTestInstanceAsync(screen.findByTestId('nav-settings')!);
        });
        expect(routerPushSpy).toHaveBeenCalledWith('/settings');
    });
});
