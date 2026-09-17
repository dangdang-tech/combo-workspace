import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';

import { createSessionFixture, flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { createExpoRouterMock } from '@/dev/testkit/mocks/router';
import { createStorageModuleMock } from '@/dev/testkit/mocks/storage';
import type { LocalSettings } from '@/sync/domains/settings/localSettings';
import { clearTempData } from '@/utils/sessions/tempDataStore';
import { installSessionRouteCommonModuleMocks } from './sessionRouteTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockSessionId = 'session-1';
let mockServerId: string | undefined;
let mockSession: any = null;
let isDataReady = true;
let sessionHydrated = true;
let sessionIsConnected = true;
let localDevModeEnabled = false;
const routerPushSpy = vi.fn();
const routerNavigateSpy = vi.fn();
const routerBackSpy = vi.fn();
const safeRouterBackSpy = vi.fn();
const readMachineTargetForSessionSpy = vi.fn();
const readDisplayMachineTargetForSessionSpy = vi.fn();
const resolveServerIdForSessionIdFromLocalCacheSpy = vi.fn();
const resolvePreferredServerIdForSessionIdSpy = vi.fn();
const usePreferredServerIdForSessionSpy = vi.fn();
const machineRpcWithServerScopeSpy = vi.fn();
const sessionStopSpy = vi.fn(async () => ({ success: true }));
const sessionReadStateSpy = vi.fn(async () => ({ success: true }));
type ArchiveSpyResult = Readonly<{
    success: boolean;
    archivedAt?: number | null;
    message?: string;
    code?: string;
}>;
const sessionArchiveSpy = vi.fn(async (): Promise<ArchiveSpyResult> => ({ success: true, archivedAt: 1 }));
const sessionDeleteSpy = vi.fn(async () => ({ success: true }));
const modalAlertSpy = vi.fn();
const modalConfirmSpy = vi.fn(async () => true);
const modalPromptSpy = vi.fn(async () => 'urgent, review');
const applySessionListRenderablePatchesSpy = vi.fn();
const createDefaultActionExecutorSpy = vi.fn<(options: unknown) => unknown>();
const completeSessionForkNavigationSpy = vi.fn<(params: unknown) => Promise<void>>(async () => undefined);
const setPinnedSessionKeysV1Spy = vi.fn();
const setSessionTagsV1Spy = vi.fn();
const openMoveSheetSpy = vi.fn(async () => null as any);
const setSessionFolderAssignmentSpy = vi.fn(async () => undefined);
const sessionOrganizationOps = vi.hoisted(() => ({
    setSessionPin: vi.fn(async () => undefined),
    setSessionTagAssignments: vi.fn(async () => undefined),
    setSessionFolderAssignment: vi.fn(async () => undefined),
    sessionSetAttentionStandingWithServerScope: vi.fn(async () => ({ success: true })),
}));
let hideInactiveSessions = false;
let sessionListAttentionPromotionMode: string | null = null;
let pinnedSessionKeysV1: unknown = null;
let sessionTagsV1: unknown = null;
let sessionFoldersV1: unknown = null;
let sessionOrganizationProjection: any = null;
let resolvedServerId = 'server-1';
let sessionHandoffFeatureEnabled = false;
let sessionFoldersFeatureEnabled = false;
let automationsEnabled = false;
let sharingSupported = false;
let sharedEntriesEnabled = false;
let removedFeaturesEnabled = false;
let terminalInfoEnabled = false;
let serverFeaturesSnapshot: any = {
    status: 'ready',
    features: {
        features: {
            sessions: {
                enabled: true,
                handoff: {
                    enabled: true,
                },
            },
            machines: {
                enabled: true,
                transfer: {
                    enabled: true,
                    directPeer: {
                        enabled: true,
                    },
                    serverRouted: {
                        enabled: false,
                    },
                },
            },
        },
        capabilities: {},
    },
};
let mockAgentCore: any = {
    resume: {},
    displayNameKey: 'agentInput.agent.claude',
    permissions: { modeGroup: 'codexLike' },
    ui: { agentPickerIconName: 'code-slash-outline' },
};
const AnimatedValue = vi.hoisted(
    () =>
        class AnimatedValue {
            constructor(_value: unknown) {}

            setValue(_value: unknown) {}

            interpolate(_config: unknown) {
                return 1;
            }
        },
);
const useHappyActionMock = vi.hoisted(() =>
    vi.fn((fn: any): readonly [boolean, any] => [false, fn] as const),
);
const mockResolveAgentIdFromFlavor = vi.fn<(flavor: string | null | undefined) => string | undefined>(() => 'claude');
const useSessionStatusSpy = vi.fn();
const itemListRenderSpy = vi.fn();
const useSessionExecutionRunsSupportedSpy = vi.fn<(sessionId: string) => boolean>(() => false);
const useSessionSpy = vi.fn<(sessionId: string) => any>(() => mockSession);
const hydrateSpy = vi.fn((sessionId: string, _tag: string, options?: { serverId?: string }) =>
    sessionHydrated
        ? { kind: 'available', sessionId, serverId: options?.serverId }
        : { kind: 'loading', sessionId, serverId: options?.serverId, reason: 'cold' },
);

const routerMock = createExpoRouterMock({
    router: {
        push: routerPushSpy,
        navigate: routerNavigateSpy,
        back: routerBackSpy,
        replace: vi.fn(),
        setParams: vi.fn(),
    },
    params: () => ({
        id: mockSessionId,
        serverId: mockServerId,
    }),
});

installSessionRouteCommonModuleMocks({
    router: async () => routerMock.module,
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: 'View',
            Animated: {
                View: 'AnimatedView',
                Value: AnimatedValue,
                loop: vi.fn(() => ({ start: vi.fn() })),
                sequence: vi.fn(() => ({ start: vi.fn() })),
                timing: vi.fn(() => ({ start: vi.fn() })),
            },
        });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            confirmResult: true,
            spies: {
                alert: modalAlertSpy,
                confirm: modalConfirmSpy,
                prompt: modalPromptSpy,
            },
        }).module;
    },
    storageModule: async (importOriginal) =>
        createStorageModuleMock({
            importOriginal,
            overrides: {
                storage: {
                    getState: () => ({
                        applySessionListRenderablePatches: applySessionListRenderablePatchesSpy,
                    }),
                } as any,
                useSession: (sessionId: string) => useSessionSpy(sessionId),
                useIsDataReady: () => isDataReady,
                useLocalSetting: <K extends keyof LocalSettings>(name: K): LocalSettings[K] => {
                    if (name === 'devModeEnabled') {
                        return localDevModeEnabled as LocalSettings[K];
                    }
                    return null as unknown as LocalSettings[K];
                },
                useSetting: (key: string) => {
                    if (key === 'hideInactiveSessions') {
                        return hideInactiveSessions;
                    }
                    if (key === 'pinnedSessionKeysV1') {
                        return pinnedSessionKeysV1;
                    }
                    if (key === 'sessionTagsV1') {
                        return sessionTagsV1;
                    }
                    if (key === 'sessionFoldersV1') {
                        return sessionFoldersV1;
                    }
                    if (key === 'sessionListAttentionPromotionModeV1') {
                        return sessionListAttentionPromotionMode;
                    }
                    return null;
                },
                useSessionOrganizationProjection: () => sessionOrganizationProjection,
                useSettingMutable: (key: string) => {
                    if (key === 'pinnedSessionKeysV1') {
                        return [pinnedSessionKeysV1, setPinnedSessionKeysV1Spy];
                    }
                    if (key === 'sessionTagsV1') {
                        return [sessionTagsV1, setSessionTagsV1Spy];
                    }
                    return [null, vi.fn()];
                },
            },
        }),
});

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
    Octicons: 'Octicons',
}));

vi.mock('@/sync/ops/sessionMachineTarget', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/sync/ops/sessionMachineTarget')>();
    return {
        ...actual,
        readMachineTargetForSession: (sessionId: string) => readMachineTargetForSessionSpy(sessionId),
        resolveMachineTargetForSessionFromState: (_state: unknown, sessionId: string) =>
            readMachineTargetForSessionSpy(sessionId),
        readDisplayMachineTargetForSession: (params: any) => readDisplayMachineTargetForSessionSpy(params),
    };
});

vi.mock('@/hooks/session/useHydrateSessionForRoute', () => ({
    useHydrateSessionForRoute: (sessionId: string, tag: string, options?: { serverId?: string }) =>
        hydrateSpy(sessionId, tag, options),
}));
vi.mock('@/utils/navigation/safeRouterBack', () => ({
    safeRouterBack: (...args: any[]) => safeRouterBackSpy(...args),
}));

vi.mock('@/components/ui/text/Text', () => ({ Text: (props: any) => React.createElement('Text', props, props.children) }));
vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement('Item', { ...props, testID: props.testID ?? props.title }, props.children),
}));
vi.mock('@/components/ui/lists/ItemGroup', () => ({ ItemGroup: 'ItemGroup' }));
vi.mock('@/components/ui/lists/ItemList', () => ({
    ItemList: (props: any) => {
        itemListRenderSpy(props);
        return React.createElement('ItemList', props, props.children);
    },
}));
vi.mock('@/components/ui/avatar/Avatar', () => ({
    Avatar: (props: any) => React.createElement('Avatar', { ...props, testID: props.testID ?? 'session-info-avatar' }),
}));
vi.mock('@/components/ui/media/CodeView', () => ({
    CodeView: ({ code, language }: { code: string; language: string }) =>
        React.createElement('CodeView', { code, language }),
}));
vi.mock('@/components/sessions/info/SessionRetentionNotice', () => ({ SessionRetentionNotice: 'SessionRetentionNotice' }));
vi.mock('@/hooks/ui/useHappyAction', () => ({ useHappyAction: (fn: any) => useHappyActionMock(fn) }));
vi.mock('@/sync/ops', () => ({
    sessionArchiveWithServerScope: sessionArchiveSpy,
    sessionDelete: sessionDeleteSpy,
    sessionDeleteWithServerScope: sessionDeleteSpy,
    sessionRename: vi.fn(),
    sessionSetManualReadStateWithServerScope: sessionReadStateSpy,
    sessionStop: sessionStopSpy,
    sessionStopWithServerScope: sessionStopSpy,
}));
vi.mock('@/agents/catalog/catalog', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/agents/catalog/catalog')>();
    return {
        ...actual,
        DEFAULT_AGENT_ID: 'claude',
        getAgentCore: () => mockAgentCore,
        resolveAgentIdFromFlavor: (flavor: string | null | undefined) => mockResolveAgentIdFromFlavor(flavor),
    };
});
vi.mock('@/hooks/session/useSessionSharingSupport', () => ({ useSessionSharingSupport: () => sharingSupported }));
vi.mock('@/hooks/server/useAutomationsSupport', () => ({
    useAutomationsSupport: () => ({ enabled: automationsEnabled }),
}));
vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => {
        if (featureId === 'sharing.sessionEntries') return sharedEntriesEnabled;
        if (removedFeaturesEnabled) return true;
        if (featureId === 'sessions.handoff') {
            return sessionHandoffFeatureEnabled;
        }
        if (featureId === 'sessions.folders') {
            return sessionFoldersFeatureEnabled;
        }
        return false;
    },
}));
vi.mock('@/components/sessions/shell/move-sheet/useSessionListMoveSheet', () => ({
    useSessionListMoveSheet: () => ({
        openMoveSheet: openMoveSheetSpy,
    }),
}));
vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: vi.fn(async () => ({ token: 'token' })),
    },
}));
vi.mock('@/sync/domains/server/serverProfiles', () => ({
    resolveServerProfileScopeId: (profile: { id: string; serverIdentityId?: string | null }) => (
        profile.serverIdentityId ?? profile.id
    ),
    getServerProfileById: (serverId: string) => ({
        id: serverId,
        serverUrl: 'https://server.example.test',
    }),
}));
vi.mock('@/sync/ops/sessionFolders', () => ({
    setSessionFolderAssignment: setSessionFolderAssignmentSpy,
}));
vi.mock('@/sync/ops/sessionOrganization', () => ({
    setSessionPin: sessionOrganizationOps.setSessionPin,
    setSessionTagLabels: sessionOrganizationOps.setSessionTagAssignments,
    setSessionFolderAssignment: sessionOrganizationOps.setSessionFolderAssignment,
    sessionSetAttentionStandingWithServerScope: sessionOrganizationOps.sessionSetAttentionStandingWithServerScope,
}));
vi.mock('@/hooks/server/useSessionExecutionRunsSupported', () => ({
    useSessionExecutionRunsSupported: (sessionId: string) => useSessionExecutionRunsSupportedSpy(sessionId),
}));
vi.mock('@/sync/ops/actions/defaultActionExecutor', () => ({
    createDefaultActionExecutor: (options: unknown) => createDefaultActionExecutorSpy(options),
}));
vi.mock('@/components/sessions/transcript/forkContext/completeSessionForkNavigation', () => ({
    completeSessionForkNavigation: (params: unknown) => completeSessionForkNavigationSpy(params),
}));
vi.mock(
    '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache',
    async (importOriginal) => {
        const { createResolveServerIdForSessionIdFromLocalCacheModuleMock } = await import(
            '@/dev/testkit/mocks/serverScopedRpc'
        );
        return createResolveServerIdForSessionIdFromLocalCacheModuleMock({
            importOriginal,
            overrides: {
                resolveServerIdForSessionIdFromLocalCache: (sessionId: string) =>
                    resolveServerIdForSessionIdFromLocalCacheSpy(sessionId),
            },
        });
    },
);
vi.mock(
    '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId',
    async (importOriginal) => {
        const { createResolvePreferredServerIdForSessionIdModuleMock } = await import(
            '@/dev/testkit/mocks/serverScopedRpc'
        );
        return createResolvePreferredServerIdForSessionIdModuleMock({
            importOriginal,
            overrides: {
                resolvePreferredServerIdForSessionId: (sessionId: string) =>
                    resolvePreferredServerIdForSessionIdSpy(sessionId),
            },
        });
    },
);
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/usePreferredServerIdForSession', () => ({
    usePreferredServerIdForSession: (sessionId: string) => usePreferredServerIdForSessionSpy(sessionId),
}));
vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (...args: unknown[]) => machineRpcWithServerScopeSpy(...args),
}));
vi.mock('@/sync/domains/features/featureDecisionRuntime', () => ({
    useServerFeaturesSnapshotForServerId: () => serverFeaturesSnapshot,
}));
vi.mock('@/sync/domains/settings/actionsSettings', () => ({ isActionEnabledInState: () => true }));
vi.mock('@/sync/domains/sessionFork/forkUiSupport', () => ({ canForkConversation: () => true }));
vi.mock('@/components/sessions/fork/openSessionForkStrategyFlow', () => ({ openSessionForkStrategyFlow: vi.fn() }));
vi.mock('@/sync/domains/sessionHandoff/handoffUiSupport', () => ({ canHandoffConversation: () => true }));
vi.mock('@/sync/domains/sessionHandoff/runSessionHandoffPickerFlow', () => ({ runSessionHandoffPickerFlow: vi.fn() }));
vi.mock('@happier-dev/protocol', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/protocol')>();
    return {
        ...actual,
        getActionSpec: () => ({
            id: 'session.handoff',
            title: 'Hand off session',
            description: 'Move the current session',
        }),
    };
});
vi.mock('@happier-dev/agents', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@happier-dev/agents')>();
    return {
        ...actual,
        resolveAgentIdFromSessionMetadata: (metadata: Record<string, unknown> | null | undefined) => {
            const runtimeDescriptor = metadata?.agentRuntimeDescriptorV1 as any;
            return typeof runtimeDescriptor?.providerId === 'string' ? runtimeDescriptor.providerId : null;
        },
    };
});
vi.mock('@/utils/sessions/sessionUtils', () => ({
    getSessionName: () => 'name',
    useSessionStatus: (...args: unknown[]) => {
        useSessionStatusSpy(...args);
        return {
            isConnected: sessionIsConnected,
            statusText: 'Connected',
            statusColor: 'green',
            statusDotColor: 'green',
            isPulsing: false,
        };
    },
    formatOSPlatform: () => 'macOS',
    formatPathRelativeToHome: (p: string) => p,
    getSessionAvatarId: () => 'id',
}));
vi.mock('expo-clipboard', () => ({ setStringAsync: vi.fn() }));
vi.mock('@/utils/system/versionUtils', () => ({ isVersionSupported: () => true, MINIMUM_CLI_VERSION: '0.0.0' }));
vi.mock('@/utils/sessions/terminalSessionDetails', () => ({
    getAttachCommandForSession: () => terminalInfoEnabled ? 'happier attach session-1' : null,
    getTmuxFallbackReason: () => terminalInfoEnabled ? 'test fallback' : null,
    getTmuxTargetForSession: () => terminalInfoEnabled ? 'test:0' : null,
}));
vi.mock('@/utils/errors/errors', () => ({ HappyError: class HappyError extends Error {} }));
vi.mock('@/sync/domains/profiles/profileUtils', () => ({ resolveProfileById: () => null }));
vi.mock('@/components/profiles/profileDisplay', () => ({ getProfileDisplayName: () => 'profile' }));
vi.mock('@/components/ui/layout/layout', () => ({ layout: { screenPaddingHorizontal: 16 } }));

describe('/session/[id]/info', () => {
    beforeEach(() => {
        mockSessionId = 'session-1';
        mockServerId = undefined;
        mockSession = null;
        isDataReady = true;
        sessionHydrated = true;
        sessionIsConnected = true;
        localDevModeEnabled = false;
        routerPushSpy.mockReset();
        routerNavigateSpy.mockReset();
        routerBackSpy.mockReset();
        safeRouterBackSpy.mockReset();
        readMachineTargetForSessionSpy.mockReset();
        readMachineTargetForSessionSpy.mockReturnValue(null);
        readDisplayMachineTargetForSessionSpy.mockReset();
        readDisplayMachineTargetForSessionSpy.mockReturnValue(null);
        sessionStopSpy.mockClear();
        sessionReadStateSpy.mockClear();
        sessionArchiveSpy.mockClear();
        sessionDeleteSpy.mockClear();
        modalAlertSpy.mockClear();
        modalConfirmSpy.mockClear();
        modalPromptSpy.mockClear();
        modalPromptSpy.mockResolvedValue('urgent, review');
        createDefaultActionExecutorSpy.mockClear();
        completeSessionForkNavigationSpy.mockClear();
        setPinnedSessionKeysV1Spy.mockClear();
        setSessionTagsV1Spy.mockClear();
        openMoveSheetSpy.mockClear();
        openMoveSheetSpy.mockResolvedValue(null);
        setSessionFolderAssignmentSpy.mockClear();
        sessionListAttentionPromotionMode = null;
        sessionOrganizationOps.sessionSetAttentionStandingWithServerScope.mockClear();
        sessionOrganizationOps.setSessionPin.mockClear();
        sessionOrganizationOps.setSessionTagAssignments.mockClear();
        sessionOrganizationOps.setSessionFolderAssignment.mockClear();
        resolvedServerId = 'server-1';
        resolveServerIdForSessionIdFromLocalCacheSpy.mockClear();
        resolvePreferredServerIdForSessionIdSpy.mockClear();
        usePreferredServerIdForSessionSpy.mockClear();
        useSessionStatusSpy.mockClear();
        itemListRenderSpy.mockClear();
        useSessionExecutionRunsSupportedSpy.mockClear();
        machineRpcWithServerScopeSpy.mockClear();
        hydrateSpy.mockClear();
        resolveServerIdForSessionIdFromLocalCacheSpy.mockReturnValue(resolvedServerId);
        resolvePreferredServerIdForSessionIdSpy.mockImplementation(() => resolvedServerId);
        usePreferredServerIdForSessionSpy.mockImplementation(() => resolvedServerId);
        machineRpcWithServerScopeSpy.mockRejectedValue(new Error('unreachable'));
        hideInactiveSessions = false;
        pinnedSessionKeysV1 = null;
        sessionTagsV1 = null;
        sessionFoldersV1 = null;
        resetSessionOrganizationProjection();
        sessionHandoffFeatureEnabled = false;
        sessionFoldersFeatureEnabled = false;
        automationsEnabled = false;
        sharingSupported = false;
        sharedEntriesEnabled = false;
        removedFeaturesEnabled = false;
        terminalInfoEnabled = false;
        useSessionExecutionRunsSupportedSpy.mockReturnValue(false);
        serverFeaturesSnapshot = {
            status: 'ready',
            features: {
                features: {
                    sessions: {
                        enabled: true,
                        handoff: {
                            enabled: true,
                        },
                    },
                    machines: {
                        enabled: true,
                        transfer: {
                            enabled: true,
                            directPeer: {
                                enabled: true,
                            },
                            serverRouted: {
                                enabled: false,
                            },
                        },
                    },
                },
                capabilities: {},
            },
        };
        mockAgentCore = {
            resume: {},
            displayNameKey: 'agentInput.agent.claude',
            permissions: { modeGroup: 'codexLike' },
            ui: { agentPickerIconName: 'code-slash-outline' },
        };
        useSessionSpy.mockClear();
        mockResolveAgentIdFromFlavor.mockReset();
        mockResolveAgentIdFromFlavor.mockReturnValue('claude');
        clearTempData();
        vi.clearAllMocks();
        useHappyActionMock.mockReset();
        useHappyActionMock.mockImplementation((fn: any) => [false, fn] as const);
        createDefaultActionExecutorSpy.mockReturnValue({});
    });

    afterEach(() => {
        clearTempData();
        standardCleanup();
    });

    async function renderInfoScreen() {
        const Screen = (await import('@/app/(app)/session/[id]/info')).default;
        return renderScreen(<Screen />);
    }

    it.each([true, false])('keeps only sharing core details even when legacy capabilities are enabled (active=%s)', async (active) => {
        localDevModeEnabled = true;
        sharingSupported = true;
        sharedEntriesEnabled = true;
        automationsEnabled = true;
        removedFeaturesEnabled = true;
        terminalInfoEnabled = true;
        useSessionExecutionRunsSupportedSpy.mockReturnValue(true);
        machineRpcWithServerScopeSpy.mockResolvedValue({ ok: true });
        readMachineTargetForSessionSpy.mockReturnValue({ machineId: 'machine-1', basePath: '/workspace/project' });
        readDisplayMachineTargetForSessionSpy.mockReturnValue({ machineId: 'machine-1', basePath: '/workspace/project' });
        mockAgentCore.resume = {
            vendorResumeIdField: 'claudeSessionId',
            uiVendorResumeIdLabelKey: 'sessionInfo.claudeCodeSessionId',
            uiVendorResumeIdCopiedKey: 'sessionInfo.claudeCodeSessionIdCopied',
        };
        sessionIsConnected = active;
        mockSession = createSessionFixture({
            id: 'session-1',
            active,
            owner: 'owner-a',
            accessLevel: undefined,
            metadata: {
                host: 'host-a',
                path: '/workspace/project',
                homeDir: '/workspace',
                machineId: 'machine-1',
                flavor: 'claude',
                claudeSessionId: 'provider-session-1',
                claudeTranscriptPath: '/tmp/provider-session.jsonl',
                sessionLogPath: '/tmp/session.log',
                version: '1.0.0',
                os: 'darwin',
                processId: 123,
                terminal: { mode: 'tmux' },
            },
            agentState: { controlledByUser: true, requests: {} },
        });

        const screen = await renderInfoScreen();
        await flushHookEffects({ cycles: 10 });

        const allowedItems = new Set([
            'sessionInfo.happySessionId', 'sessionInfo.connectionStatus', 'sessionInfo.created',
            'sessionInfo.lastUpdated', 'sessionInfo.renameSession', 'session-shared-entry-management',
            'sessionInfo.stopSession', 'sessionInfo.archiveSession', 'sessionInfo.deleteSession',
            'sessionInfo.host', 'sessionInfo.path', 'sessionInfo.sessionStatus',
        ]);
        const itemIds = screen.findAllByType('Item' as any).map((node) => node.props.testID);
        expect(itemIds.filter((id) => !allowedItems.has(id))).toEqual([]);
        expect(screen.findByTestId('sessionInfo.happySessionId')?.props.copy).toBe('session-1');
        expect(screen.findByTestId('sessionInfo.host')?.props.subtitle).toBe('host-a');
        expect(screen.findByTestId('sessionInfo.path')?.props.subtitle).toBe('/workspace/project');
        expect(screen.findByTestId('session-shared-entry-management')).not.toBeNull();
        expect(useSessionExecutionRunsSupportedSpy).not.toHaveBeenCalled();
        expect(machineRpcWithServerScopeSpy).not.toHaveBeenCalled();
    });

    it('opens entry sharing on the source session route server', async () => {
        mockServerId = 'server-b';
        sharedEntriesEnabled = true;
        mockSession = createSessionFixture({ id: 'session-1', owner: 'owner-a', accessLevel: undefined });

        const screen = await renderInfoScreen();
        screen.pressByTestId('session-shared-entry-management');

        expect(routerPushSpy).toHaveBeenCalledWith('/session/session-1/entry-sharing?serverId=server-b');
    });

    it.each([
        { accessLevel: 'view' as const, active: true },
        { accessLevel: 'edit' as const, active: true },
        { accessLevel: 'view' as const, active: false },
        { accessLevel: 'edit' as const, active: false },
    ])('keeps managed $accessLevel guests outside entry management and lifecycle mutations (active=$active)', async ({ accessLevel, active }) => {
        sharedEntriesEnabled = true;
        sessionIsConnected = active;
        mockSession = createSessionFixture({
            id: 'session-1', active, owner: 'owner-a', accessLevel,
            metadata: { host: 'host-a', path: '/workspace/project', sharedSessionEntryId: 'entry-1' },
        });

        const screen = await renderInfoScreen();

        for (const id of ['session-shared-entry-management', 'sessionInfo.renameSession', 'sessionInfo.stopSession', 'sessionInfo.archiveSession', 'sessionInfo.deleteSession']) {
            expect(screen.findByTestId(id)).toBeNull();
        }
        expect(screen.findByTestId('sessionInfo.happySessionId')).not.toBeNull();
    });

    it('does not offer entry management on the owner copy of a managed child session', async () => {
        sharedEntriesEnabled = true;
        mockSession = createSessionFixture({
            id: 'session-1', owner: 'owner-a', accessLevel: undefined,
            metadata: { host: 'host-a', path: '/workspace/project', sharedSessionEntryId: 'entry-1' },
        });

        const screen = await renderInfoScreen();

        expect(screen.findByTestId('session-shared-entry-management')).toBeNull();
        expect(screen.findByTestId('sessionInfo.renameSession')).not.toBeNull();
    });

    function setSessionOwnerServer(serverId: string | null) {
        resolvedServerId = serverId ?? 'server-1';
        resolveServerIdForSessionIdFromLocalCacheSpy.mockReturnValue(serverId);
        resolvePreferredServerIdForSessionIdSpy.mockReturnValue(serverId);
        usePreferredServerIdForSessionSpy.mockReturnValue(serverId);
    }

    function resetSessionOrganizationProjection(overrides: Record<string, unknown> = {}) {
        sessionOrganizationProjection = {
            schemaVersion: 1,
            version: 1,
            pinnedSessionIds: [],
            pinsBySessionId: {},
            foldersById: {},
            folderAssignmentsBySessionId: {},
            tagsById: {},
            tagAssignmentsBySessionId: {},
            attentionStandingsBySessionId: {},
            orderEntriesByScopeKey: {},
            labelsByLabelKey: {},
            ...overrides,
        };
    }

    it('shows loading while the route hydration is still in progress', async () => {
        sessionHydrated = false;
        mockServerId = 'server-b';
        const screen = await renderInfoScreen();
        expect(screen.getTextContent()).toContain('common.loading');
        expect(hydrateSpy).toHaveBeenCalledWith('session-1', 'SessionInfoRoute.ensureSessionVisible', { serverId: 'server-b' });
    });

    it('fails open and renders the session when the record exists even if global hydration is still in progress', async () => {
        mockSession = {
            id: 'session-1234567890abcdef',
            active: false,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
        };
        isDataReady = false;
        sessionHydrated = false;
        const screen = await renderInfoScreen();
        expect(screen.getTextContent()).not.toContain('common.loading');
        expect(screen.getTextContent()).toContain('name');
    });

    it('normalizes the route id before looking up the session', async () => {
        mockSessionId = ['session-2 '] as any;
        await renderInfoScreen();
        expect(useSessionSpy).toHaveBeenCalledWith('session-2');
    });

    it('keeps the entry-sharing route scoped when only volatile session fields change', async () => {
        mockServerId = 'server-b';
        sharedEntriesEnabled = true;
        mockSession = {
            id: 'session-1234567890abcdef',
            active: true,
            accessLevel: null,
            createdAt: 100,
            updatedAt: 200,
            seq: 1,
            metadata: {},
        };

        const Screen = (await import('@/app/(app)/session/[id]/info')).default;
        const screen = await renderScreen(<Screen />);
        screen.pressByTestId('session-shared-entry-management');
        expect(routerPushSpy).toHaveBeenLastCalledWith('/session/session-1234567890abcdef/entry-sharing?serverId=server-b');

        mockSession = {
            ...mockSession,
            updatedAt: 300,
            seq: 2,
            thinkingAt: 301,
        };

        await screen.update(<Screen />);

        screen.pressByTestId('session-shared-entry-management');
        expect(routerPushSpy).toHaveBeenLastCalledWith('/session/session-1234567890abcdef/entry-sharing?serverId=server-b');
    });

    it('derives status from the route session without duplicate store subscriptions', async () => {
        mockSession = {
            id: 'session-1234567890abcdef',
            active: true,
            accessLevel: null,
            createdAt: 100,
            updatedAt: 200,
            seq: 1,
            metadata: {},
        };

        await renderInfoScreen();

        expect(useSessionStatusSpy).toHaveBeenCalledWith(mockSession, {
            subscribeToSession: false,
            subscribeToTranscript: false,
        });
    });

    it('shows projected product activity before raw thinking diagnostics', async () => {
        mockSession = {
            id: 'session-1234567890abcdef',
            active: true,
            accessLevel: null,
            createdAt: 100,
            updatedAt: 200,
            seq: 1,
            thinking: true,
            thinkingAt: 150,
            latestTurnStatus: 'completed',
            latestTurnStatusObservedAt: 180,
            metadata: {},
        };

        const screen = await renderInfoScreen();

        const activityStatusItem = screen.findAllByType('Item' as any)
            .find((node: any) => node.props?.title === 'sessionInfo.sessionStatus');
        expect(activityStatusItem?.props.detail).toBe('Connected');
    });

    it('updates product activity status inputs when pending freshness projection changes', async () => {
        mockSession = {
            id: 'session-1234567890abcdef',
            active: true,
            activeAt: 1,
            presence: 'online',
            accessLevel: null,
            createdAt: 100,
            updatedAt: 200,
            seq: 1,
            pendingPermissionRequestCount: 1,
            pendingUserActionRequestCount: 0,
            pendingRequestObservedAt: 10,
            latestTurnStatus: 'in_progress',
            latestTurnStatusObservedAt: 10,
            metadata: {},
        };

        const Screen = (await import('@/app/(app)/session/[id]/info')).default;
        const screen = await renderScreen(<Screen />);
        useSessionStatusSpy.mockClear();

        mockSession = {
            ...mockSession,
            pendingRequestObservedAt: 300,
        };

        await screen.update(<Screen />);

        expect(useSessionStatusSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                pendingRequestObservedAt: 300,
            }),
            {
                subscribeToSession: false,
                subscribeToTranscript: false,
            },
        );
    });

    it('does not rebuild the full info list when only volatile session counters change', async () => {
        mockSession = {
            id: 'session-1234567890abcdef',
            active: true,
            accessLevel: null,
            createdAt: 100,
            updatedAt: 200,
            seq: 1,
            metadata: {},
        };

        const Screen = (await import('@/app/(app)/session/[id]/info')).default;
        const screen = await renderScreen(<Screen />);
        expect(itemListRenderSpy).toHaveBeenCalled();
        itemListRenderSpy.mockClear();

        mockSession = {
            ...mockSession,
            updatedAt: 300,
            seq: 2,
        };

        await screen.update(<Screen />);

        expect(itemListRenderSpy).not.toHaveBeenCalled();
    });

    it('does not subscribe to execution-run session signals while the runs feature is disabled', async () => {
        mockSession = {
            id: 'session-1234567890abcdef',
            active: true,
            accessLevel: null,
            createdAt: 100,
            updatedAt: 200,
            seq: 1,
            metadata: {},
        };

        await renderInfoScreen();

        expect(useSessionExecutionRunsSupportedSpy).not.toHaveBeenCalled();
    });

    it('infers the avatar provider from agentRuntimeDescriptorV1 when flavor is missing', async () => {
        mockAgentCore = {
            resume: {
                vendorResumeIdField: 'opencodeSessionId',
                uiVendorResumeIdLabelKey: 'sessionInfo.openCodeSessionId',
                uiVendorResumeIdCopiedKey: 'sessionInfo.openCodeSessionIdCopied',
            },
            displayNameKey: 'agents.opencode.displayName',
            ui: { agentPickerIconName: 'code-slash-outline' },
        };
        mockSession = {
            id: 'session-1234567890abcdef',
            active: false,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {
                agentRuntimeDescriptorV1: {
                    v: 1,
                    providerId: 'opencode',
                    provider: {
                        backendMode: 'server',
                        vendorSessionId: 'runtime-session-1234567890',
                    },
                },
            },
        };

        const screen = await renderInfoScreen();
        expect(mockResolveAgentIdFromFlavor).not.toHaveBeenCalled();
        const avatar = screen.findByTestId('session-info-avatar');
        if (!avatar) {
            throw new Error('expected session info avatar');
        }
        expect(avatar.props.flavor).toBe('opencode');
    });

    it('stops without archiving even when inactive sessions are hidden and unpinned', async () => {
        mockServerId = 'server-b';
        setSessionOwnerServer('server-b');
        hideInactiveSessions = true;
        pinnedSessionKeysV1 = [];
        mockSession = {
            id: 'session-1',
            active: true,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
        };

        const screen = await renderInfoScreen();
        await screen.pressByTestIdAsync('sessionInfo.stopSession');

        expect(modalConfirmSpy).toHaveBeenCalledWith(
            'sessionInfo.stopSession',
            'sessionInfo.stopSessionConfirm',
            {
                cancelText: 'common.cancel',
                confirmText: 'sessionInfo.stopSession',
                destructive: true,
            },
        );
        expect(modalAlertSpy).not.toHaveBeenCalled();

        expect(sessionStopSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-b' });
        expect(sessionArchiveSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(safeRouterBackSpy).toHaveBeenCalledTimes(2);
        expect(safeRouterBackSpy).toHaveBeenNthCalledWith(1, {
            router: expect.any(Object),
            fallbackHref: '/session/session-1?serverId=server-b',
        });
        expect(safeRouterBackSpy).toHaveBeenNthCalledWith(2, {
            router: expect.any(Object),
            fallbackHref: '/',
        });
    });

    it('stops with the cached owning server id when route scope and preferred scope are unavailable', async () => {
        mockServerId = undefined;
        hideInactiveSessions = true;
        pinnedSessionKeysV1 = [];
        resolvedServerId = 'server-cache-info';
        resolveServerIdForSessionIdFromLocalCacheSpy.mockReturnValue('server-cache-info');
        usePreferredServerIdForSessionSpy.mockReturnValue(null);
        mockSession = {
            id: 'session-1',
            active: true,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
        };

        const screen = await renderInfoScreen();
        await screen.pressByTestIdAsync('sessionInfo.stopSession');

        expect(modalConfirmSpy).toHaveBeenCalledTimes(1);
        expect(sessionStopSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-cache-info' });
    });

    it('stops with the cached owning server id when the route server id is stale', async () => {
        mockServerId = 'stale-route-server';
        hideInactiveSessions = true;
        pinnedSessionKeysV1 = [];
        resolvedServerId = 'server-cache-info';
        resolveServerIdForSessionIdFromLocalCacheSpy.mockReturnValue('server-cache-info');
        usePreferredServerIdForSessionSpy.mockReturnValue('server-cache-info');
        mockSession = {
            id: 'session-1',
            active: true,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
        };

        const screen = await renderInfoScreen();
        await screen.pressByTestIdAsync('sessionInfo.stopSession');

        expect(modalConfirmSpy).toHaveBeenCalledTimes(1);
        expect(sessionStopSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-cache-info' });
    });

    it('stops without prompting to archive when the session is pinned', async () => {
        mockServerId = 'server-b';
        setSessionOwnerServer('server-b');
        hideInactiveSessions = true;
        pinnedSessionKeysV1 = [];
        resetSessionOrganizationProjection({
            pinnedSessionIds: ['session-1'],
            pinsBySessionId: {
                'session-1': {
                    sessionId: 'session-1',
                    sortKey: null,
                    pinnedAt: 1,
                },
            },
        });
        mockSession = {
            id: 'session-1',
            active: true,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
        };

        const screen = await renderInfoScreen();
        await screen.pressByTestIdAsync('sessionInfo.stopSession');

        expect(modalConfirmSpy).toHaveBeenCalledTimes(1);

        expect(sessionStopSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-b' });
        expect(sessionArchiveSpy).not.toHaveBeenCalled();
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(safeRouterBackSpy).toHaveBeenCalledTimes(2);
        expect(safeRouterBackSpy).toHaveBeenNthCalledWith(1, {
            router: expect.any(Object),
            fallbackHref: '/session/session-1?serverId=server-b',
        });
        expect(safeRouterBackSpy).toHaveBeenNthCalledWith(2, {
            router: expect.any(Object),
            fallbackHref: '/',
        });
    });

    it('archives an inactive session and exits via the safe back helper', async () => {
        mockServerId = 'server-b';
        setSessionOwnerServer('server-b');
        mockSession = {
            id: 'session-1',
            active: false,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
            archivedAt: null,
        };

        const screen = await renderInfoScreen();
        await screen.pressByTestIdAsync('sessionInfo.archiveSession');

        expect(modalConfirmSpy).toHaveBeenCalledWith(
            'sessionInfo.archiveSession',
            'sessionInfo.archiveSessionConfirm',
            {
                cancelText: 'common.cancel',
                confirmText: 'sessionInfo.archiveSession',
                destructive: true,
            },
        );
        expect(modalAlertSpy).not.toHaveBeenCalled();

        expect(sessionArchiveSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-b' });
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(safeRouterBackSpy).toHaveBeenCalledTimes(2);
        expect(safeRouterBackSpy).toHaveBeenNthCalledWith(1, {
            router: expect.any(Object),
            fallbackHref: '/session/session-1?serverId=server-b',
        });
        expect(safeRouterBackSpy).toHaveBeenNthCalledWith(2, {
            router: expect.any(Object),
            fallbackHref: '/',
        });
    });

    it('stops and retries archiving when an inactive session is still active server-side', async () => {
        mockServerId = 'server-b';
        setSessionOwnerServer('server-b');
        sessionArchiveSpy
            .mockResolvedValueOnce({
                success: false,
                message: 'Cannot archive an active session',
                code: 'session_active',
            })
            .mockResolvedValueOnce({ success: true, archivedAt: 1 });
        mockSession = {
            id: 'session-1',
            active: false,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
            archivedAt: null,
        };

        const screen = await renderInfoScreen();
        await screen.pressByTestIdAsync('sessionInfo.archiveSession');

        expect(modalAlertSpy).not.toHaveBeenCalled();
        expect(sessionArchiveSpy).toHaveBeenCalledTimes(2);
        expect(sessionStopSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-b' });
        expect(safeRouterBackSpy).toHaveBeenCalledTimes(2);
    });

    it('deletes a session and exits via the safe back helper', async () => {
        mockServerId = 'server-b';
        setSessionOwnerServer('server-b');
        sessionIsConnected = false;
        mockSession = {
            id: 'session-1',
            active: false,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
            archivedAt: null,
        };

        const screen = await renderInfoScreen();
        screen.pressByTestId('sessionInfo.deleteSession');

        expect(modalAlertSpy).toHaveBeenCalledWith(
            'sessionInfo.deleteSession',
            'sessionInfo.deleteSessionWarning',
            expect.arrayContaining([
                expect.objectContaining({ text: 'common.cancel', style: 'cancel' }),
                expect.objectContaining({ text: 'sessionInfo.deleteSession', style: 'destructive' }),
            ]),
        );

        const alertButtons = modalAlertSpy.mock.calls[0]?.[2];
        const deleteButton = alertButtons?.find((button: { text?: string }) => button.text === 'sessionInfo.deleteSession');
        if (!deleteButton?.onPress) {
            throw new Error('expected delete confirmation button to expose onPress');
        }

        await act(async () => {
            await deleteButton.onPress();
        });

        expect(sessionDeleteSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-b' });
        expect(routerBackSpy).not.toHaveBeenCalled();
        expect(safeRouterBackSpy).toHaveBeenCalledTimes(2);
        expect(safeRouterBackSpy).toHaveBeenNthCalledWith(1, {
            router: expect.any(Object),
            fallbackHref: '/session/session-1?serverId=server-b',
        });
        expect(safeRouterBackSpy).toHaveBeenNthCalledWith(2, {
            router: expect.any(Object),
            fallbackHref: '/',
        });
    });

    it('archives an active session by stopping it first and then archiving it', async () => {
        mockServerId = 'server-b';
        setSessionOwnerServer('server-b');
        mockSession = {
            id: 'session-1',
            active: true,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
        };

        const screen = await renderInfoScreen();
        await screen.pressByTestIdAsync('sessionInfo.archiveSession');

        expect(modalConfirmSpy).toHaveBeenCalledTimes(1);

        expect(sessionStopSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-b' });
        expect(sessionArchiveSpy).toHaveBeenCalledWith('session-1', { serverId: 'server-b' });
        expect(safeRouterBackSpy).toHaveBeenCalledTimes(2);
    });

    it('shows loading on the stop and archive rows while their mutations are running', async () => {
        useHappyActionMock.mockImplementation((fn: any) => [true, fn] as const);
        mockSession = {
            id: 'session-1',
            active: true,
            accessLevel: null,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
            archivedAt: null,
        };

        const screen = await renderInfoScreen();

        expect(screen.findByTestId('sessionInfo.stopSession')?.props.loading).toBe(true);
        expect(screen.findByTestId('sessionInfo.archiveSession')?.props.loading).toBe(true);
    });

    it('does not offer archive for active shared sessions even when the viewer has admin access', async () => {
        mockServerId = 'server-b';
        mockSession = {
            id: 'session-1',
            active: true,
            accessLevel: 'admin',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
            archivedAt: null,
        };

        const screen = await renderInfoScreen();

        expect(screen.findByTestId('sessionInfo.archiveSession')).toBeNull();
    });

    it.each(['view', 'edit'] as const)('hides rename quick action for %s shared sessions', async (accessLevel) => {
        mockServerId = 'server-b';
        mockSession = {
            id: 'session-1',
            active: false,
            accessLevel,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            seq: 1,
            metadata: {},
            archivedAt: null,
        };

        const screen = await renderInfoScreen();
        const renameItems = screen.findAllByType('Item' as any)
            .filter((node: any) => node.props?.title === 'sessionInfo.renameSession');

        expect(renameItems).toHaveLength(0);
    });
});
