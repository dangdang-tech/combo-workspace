import * as React from 'react';
import renderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBackendTargetKey, type AcpCatalogSettingsV1 } from '@happier-dev/protocol';
import {
    flushHookEffects,
    renderHook,
    renderScreen,
} from '@/dev/testkit';
import { storage as storageStore } from '@/sync/domains/state/storageStore';
import type { AIBackendProfile } from '@/sync/domains/profiles/profileCompatibility';
import type { NewSessionDraft } from '@/sync/domains/state/persistence';
import { buildNewSessionAuthoringDraftFromPersistedDraft } from '@/components/sessions/authoring/draft/sessionAuthoringDraftAdapters';
import {
    deleteSessionDraft,
    writeNewSessionDraft,
    writeSessionDraftLocalSupplement,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';
import { buildNewSessionDraftLocalState } from '@/sync/ops/sessionDrafts/newSessionDraftLocalState';

import { installNewSessionScreenModelCommonModuleMocks } from './newSessionScreenModelTestHelpers';
import { buildNewSessionDraftPatch } from './screenModel/newSessionDraftRepositoryAdapter';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const pendingFireAndForget = vi.hoisted((): Array<Promise<unknown>> => []);
const applySettingsMock = vi.hoisted(() => vi.fn());
const modalShowMock = vi.hoisted(() => vi.fn(() => 'modal-id'));
const modalAlertMock = vi.hoisted(() => vi.fn());
const createSessionActionDraftMock = vi.hoisted(() => vi.fn());
const handleCreateSessionMock = vi.hoisted(() =>
    vi.fn((opts?: { afterCreated?: (context: { sessionId: string; effectiveSpawnServerId: string | null }) => void | Promise<void> }) => {
        return opts?.afterCreated?.({ sessionId: 'session-created', effectiveSpawnServerId: null });
    }),
);
const agentInputActionChipActionIdsState = vi.hoisted(() => ({
    value: [] as string[],
}));

const enabledAgentIdsState = vi.hoisted(() => ({
    value: ['codex', 'claude'] as string[],
}));

const cliAvailabilityRefreshMock = vi.hoisted(() => vi.fn());

type CliAvailabilityMockValue = Partial<{
    refresh: ReturnType<typeof vi.fn>;
    isDetecting: boolean;
    timestamp: number;
    available: { codex: boolean; claude: boolean; opencode: boolean | null };
    login: any;
    authStatus: any;
    resolvedPath: any;
    resolvedCommand: any;
    resolutionSource: any;
    tmux: null;
}>;

const cliAvailabilityDefaults = vi.hoisted(() => ({
    refresh: cliAvailabilityRefreshMock,
    isDetecting: false,
    timestamp: 1,
    available: { codex: false, claude: true, opencode: null as boolean | null },
    login: {} as any,
    authStatus: {} as any,
    resolvedPath: {} as any,
    resolvedCommand: {} as any,
    resolutionSource: {} as any,
    tmux: null,
}));

const cliAvailabilityState = vi.hoisted(() => ({
    value: {} as CliAvailabilityMockValue,
}));

const featureEnabledState = vi.hoisted(() => ({
    sessionsDirect: false,
}));
const featureEnabledCalls = vi.hoisted(() => [] as Array<Readonly<{ featureId: string; scope: unknown }>>);
const chromeSafeAreaInsetsState = vi.hoisted(() => ({
    value: { top: 0, bottom: 0, left: 0, right: 0 },
}));
const preflightModelOptionsByTargetKeyState = vi.hoisted(() => ({
    value: {} as Record<string, Array<{ value: string; label: string; description?: string }>>,
}));
const preflightSessionModeOptionsByTargetKeyState = vi.hoisted(() => ({
    value: {} as Record<string, Array<{ id: string; name: string; description?: string }>>,
}));
const preflightConfigOptionsByTargetKeyState = vi.hoisted(() => ({
    value: {} as Record<string, Array<{
        id: string;
        name: string;
        type: string;
        currentValue: string;
        description?: string;
        options?: Array<{ value: string; name: string; description?: string }>;
    }>>,
}));

const profileCompatibilityState = vi.hoisted(() => ({
    isProfileCompatibleWithAgent: (((_profile: any, _agentId: string) => true) as (profile: any, agentId: string) => boolean),
    isProfileCompatibleWithBackendTarget: (((_profile: any, _target: any) => true) as (profile: any, target: any) => boolean),
    isProfileCompatibleWithAnyAgent: (((_profile: any, _agentIds: readonly string[]) => true) as (profile: any, agentIds: readonly string[]) => boolean),
    getProfileSupportedAgentIds: (((_profile: any) => [] as string[]) as (profile: any) => string[]),
}));

const testSettingsDefaults = vi.hoisted(() => ({
    recentMachinePaths: [] as Array<{ machineId: string; path: string }>,
    lastUsedAgent: 'codex',
    lastUsedPermissionMode: 'default',
    newSessionDefaultPersistenceModeV1: 'persisted' as 'persisted' | 'direct',
    newSessionDefaultPersistenceModeByTargetKeyV1: {} as Record<string, 'persisted' | 'direct'>,
    useEnhancedSessionWizard: false,
    useProfiles: false,
    sessionDefaultPermissionModeByTargetKey: {},
    actionsSettingsV1: {},
    experiments: false,
    featureToggles: {},
    dismissedCLIWarnings: {},
    sessionUseTmux: false,
    sessionTmuxByMachineId: {},
    favoriteDirectories: [],
    favoriteMachines: [],
    favoriteProfiles: [],
    profiles: [] as AIBackendProfile[],
    secrets: [],
    secretBindingsByProfileId: {},
    serverSelectionGroups: [],
    serverSelectionActiveTargetKind: null,
    serverSelectionActiveTargetId: null,
    codexBackendMode: 'acp',
    installablesPolicyByMachineId: {},
    sessionWindowsRemoteSessionLaunchMode: 'hidden' as 'hidden' | 'windows_terminal' | 'console',
    backendEnabledByTargetKey: {} as Record<string, boolean>,
    mcpServersSettingsV1: {
        v: 1,
        strictMode: false,
        servers: [],
        bindings: [],
    },
    acpCatalogSettingsV1: {
        v: 2 as const,
        backends: [],
    } as AcpCatalogSettingsV1,
}));

const settingsState = vi.hoisted(() => ({
    ...testSettingsDefaults,
}));
const settingsRuntimeState = vi.hoisted(() => ({
    current: settingsState as typeof settingsState | undefined,
}));

const machineState = vi.hoisted(() => ({
    value: [
        { id: 'machine-1', metadata: { displayName: 'Machine One', host: 'one', homeDir: '/home/one' } },
    ] as Array<{ id: string; metadata: Record<string, unknown> }>,
}));

const machineCapabilitiesResultsState = vi.hoisted(() => ({
    value: {
        'dep.codex-acp': {
            ok: true as const,
            checkedAt: Date.now(),
            data: {
                installed: false,
                installDir: '/tmp',
                binPath: null,
                installedVersion: null,
                sourceKind: 'github_release_binary',
                lastInstallLogPath: null,
            },
        },
    } as Record<string, unknown>,
}));

const storageState = vi.hoisted(() => ({
    workspaceLocations: {} as Record<string, unknown>,
    workspaceCheckouts: {} as Record<string, unknown>,
    // The `@session` picker's real source. Seeded per test so the host's server scoping is
    // observable through the production projection instead of a stubbed resolver.
    sessionListViewDataByServerId: {} as Record<string, unknown[]>,
}));

const getMockStorageState = vi.hoisted(() => () => ({
    settings: settingsRuntimeState.current ?? testSettingsDefaults,
    sessions: {},
    workspaceLocations: storageState.workspaceLocations,
    workspaceCheckouts: storageState.workspaceCheckouts,
    sessionListViewDataByServerId: storageState.sessionListViewDataByServerId,
    createSessionActionDraft: createSessionActionDraftMock,
}));

const persistedDraft = vi.hoisted(() => ({
    input: '',
    selectedMachineId: 'machine-1',
    selectedPath: '/repo',
    selectedProfileId: null as string | null,
    selectedSecretId: null,
    agentType: 'codex' as string,
    permissionMode: 'default',
    modelMode: 'default',
    acpSessionModeId: 'plan',
    agentNewSessionOptionStateByAgentId: {},
    updatedAt: 123,
}));
const TEST_DRAFT_ID = 'installables-test-draft';
const TEST_DRAFT_SCOPE = { serverId: 's_active', accountId: 'acct_active' } as const;

const initialHookFlushOptions = { cycles: 2, turns: 2 } as const;

async function renderNewSessionScreenModel() {
    await deleteSessionDraft({
        scope: TEST_DRAFT_SCOPE,
        address: { kind: 'newSession', draftId: TEST_DRAFT_ID },
    });
    const draft = persistedDraft as unknown as NewSessionDraft;
    writeNewSessionDraft({
        scope: TEST_DRAFT_SCOPE,
        draftId: TEST_DRAFT_ID,
        patch: buildNewSessionDraftPatch({
            authoringDraft: buildNewSessionAuthoringDraftFromPersistedDraft(draft),
            machineId: draft.selectedMachineId,
            serverId: draft.targetServerId ?? null,
            text: draft.input,
        }),
        materializationIntent: 'userEdit',
    });
    writeSessionDraftLocalSupplement({
        scope: TEST_DRAFT_SCOPE,
        address: { kind: 'newSession', draftId: TEST_DRAFT_ID },
        patch: { newSessionLocalState: buildNewSessionDraftLocalState(draft) },
    });
    const { useNewSessionScreenModel } = await useNewSessionScreenModelModulePromise;
    return renderHook<any>(() => useNewSessionScreenModel({ draftId: TEST_DRAFT_ID }) as any, {
        flushOptions: initialHookFlushOptions,
    });
}

async function invokeHookAction(action: () => void | Promise<void>) {
    await act(async () => {
        await action();
    });
    await flushHookEffects({ cycles: 1, turns: 2 });
}

installNewSessionScreenModelCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: {
                OS: 'web',
                select: (options: any) => options?.web ?? options?.default ?? options?.ios ?? options?.android,
            },
            Text: 'Text',
            TextInput: 'TextInput',
            View: 'View',
            Pressable: 'Pressable',
            Dimensions: {
                get: () => ({ width: 900, height: 800 }),
            },
            InteractionManager: {
                runAfterInteractions: () => ({ cancel: () => {} }),
            },
            useWindowDimensions: () => ({ width: 900, height: 800 }),
        });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    text: '#000',
                    textSecondary: '#666',
                    shadow: { color: '#000' },
                    modal: { border: '#ddd' },
                    button: { primary: { background: '#00f', tint: '#fff' } },
                    groupped: { sectionTitle: '#999', background: '#fff' },
                    input: { background: '#fff', placeholder: '#999' },
                    radio: { active: '#00f' },
                    divider: '#ddd',
                    surface: '#fff',
                    surfaceHigh: '#f2f2f2',
                    surfaceHighest: '#e9e9e9',
                    surfacePressed: '#ececec',
                    surfacePressedOverlay: '#eee',
                    surfaceSelected: '#f7f7f7',
                    accent: { blue: '#00f' },
                    textDestructive: '#c00',
                },
            },
            rt: { themeName: 'light' },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                show: modalShowMock,
                alert: modalAlertMock,
                prompt: vi.fn(async () => null),
                confirm: vi.fn(async () => false),
            },
        }).module;
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        const expoRouterMock = createExpoRouterMock({
            router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), setParams: vi.fn() },
            params: {},
            navigation: {},
            pathname: '/new',
        });
        return expoRouterMock.module;
    },
    storage: async (importOriginal) => {
        const { createPartialStorageModuleMock } = await import('@/dev/testkit/createPartialStorageModuleMock');
        return createPartialStorageModuleMock(importOriginal, {
            // Boundary fixture: this suite only consumes the machine id + metadata shape.
            useAllMachines: (() => machineState.value as any) as any,
            useLaunchSelectionMachines: (() => machineState.value as any) as any,
            useMachineListByServerId: (() => ({ s_active: machineState.value, s1: machineState.value }) as any) as any,
            useMachineListStatusByServerId: (() => ({ s_active: 'loaded', s1: 'loaded' }) as any) as any,
            storage: Object.assign((selector: (state: ReturnType<typeof getMockStorageState>) => unknown) => selector(getMockStorageState()), {
                getState: () => getMockStorageState(),
            }) as any,
            useSetting: (key: string) => (settingsRuntimeState.current as any)?.[key] ?? (testSettingsDefaults as any)[key],
            useSettingMutable: (key: string) => [
                (settingsRuntimeState.current as any)?.[key] ?? (testSettingsDefaults as any)[key],
                vi.fn(),
            ],
            // Boundary fixture: the suite overrides only the settings fields it actually reads.
            useSettings: (() => (settingsRuntimeState.current ?? testSettingsDefaults) as any) as any,
        });
    },
});

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/layout/useChromeSafeAreaInsets', () => ({
    useChromeSafeAreaInsets: () => chromeSafeAreaInsetsState.value,
}));

vi.mock('@/utils/platform/responsive', () => ({
    useHeaderHeight: () => 0,
}));

vi.mock('@expo/vector-icons', () => ({
    Ionicons: 'Ionicons',
}));

vi.mock('@react-navigation/native', () => ({
    useIsFocused: () => true,
    useFocusEffect: (_fn: any) => {},
}));

vi.mock('@/sync/sync', () => ({
    sync: {
        refreshMachinesThrottled: async () => {},
        encryptSecretValue: (v: string) => v,
    },
}));

vi.mock('@/sync/store/settingsWriters', () => ({
    useApplySettings: () => applySettingsMock,
}));

vi.mock('@/agents/hooks/useEnabledAgentIds', () => ({
    useEnabledAgentIds: () => enabledAgentIdsState.value,
}));

vi.mock('@/hooks/auth/useCLIDetection', () => ({
    useCLIDetection: () => ({
        ...cliAvailabilityDefaults,
        ...cliAvailabilityState.value,
        refresh: cliAvailabilityRefreshMock,
        available: cliAvailabilityState.value.available ?? cliAvailabilityDefaults.available,
        tmux: cliAvailabilityState.value.tmux ?? cliAvailabilityDefaults.tmux,
    }),
}));

vi.mock('@/utils/sessions/machineUtils', () => ({
    isMachineOnline: () => true,
}));

const machineCapabilitiesInvoke = vi.hoisted(() =>
    vi.fn(async () => ({ supported: true, response: { ok: true, result: null } })),
);
const machineCapabilitiesCacheRefreshMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/ops', () => ({
    machineCapabilitiesInvoke,
}));

// The one genuine boundary the file search crosses. Mocked here (and nowhere above it) so the
// real registry, dispatcher, scope resolver and file index all run, and the assertion below can
// see the machine and folder this host actually addresses.
const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn(async (_params: unknown) => ({} as unknown)));

vi.mock(
    '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc',
    async (importOriginal) => {
        const { installServerScopedMachineRpcModuleMock } = await import('@/dev/testkit/mocks/serverScopedRpc');
        return installServerScopedMachineRpcModuleMock({
            machineRpcWithServerScope: (params: unknown) => machineRpcWithServerScopeMock(params) as never,
        })(importOriginal);
    },
);

vi.mock('@/hooks/server/useDaemonScopedMachineCapabilitiesCache', () => ({
    useDaemonScopedMachineCapabilitiesCache: () => ({
        state: {
            status: 'loaded' as const,
            snapshot: {
                response: {
                    protocolVersion: 1 as const,
                    results: machineCapabilitiesResultsState.value,
                },
            },
        },
        refresh: machineCapabilitiesCacheRefreshMock,
    }),
}));

vi.mock('@/hooks/server/useMachineCapabilitiesCache', () => ({
    prefetchMachineCapabilities: async () => {},
    prefetchMachineCapabilitiesIfStale: async () => {},
    getMachineCapabilitiesSnapshot: () => ({
        response: {
            protocolVersion: 1 as const,
            results: machineCapabilitiesResultsState.value,
        },
    }),
}));

vi.mock('@/components/sessions/new/hooks/useNewSessionCapabilitiesPrefetch', () => ({
    useNewSessionCapabilitiesPrefetch: () => {},
}));

vi.mock('@/components/sessions/new/hooks/useNewSessionDraftAutoPersist', () => ({
    useNewSessionDraftAutoPersist: () => {},
}));

vi.mock('@/components/sessions/new/hooks/useCreateNewSession', () => ({
    useCreateNewSession: () => ({
        canCreate: true,
        connectionStatus: 'ok',
        handleCreateSession: handleCreateSessionMock,
    }),
}));

vi.mock('@/components/sessions/agentInput/sessionActions/listAgentInputActionChipActionIds', () => ({
    listAgentInputActionChipActionIds: () => agentInputActionChipActionIdsState.value,
}));

vi.mock('@/utils/system/fireAndForget', () => ({
    fireAndForget: (promise: Promise<unknown>) => {
        pendingFireAndForget.push(promise);
        void promise.catch(() => {});
    },
}));

vi.mock('@/utils/sessions/tempDataStore', () => ({
    getTempData: () => null,
}));

vi.mock('@/hooks/server/useAutomationsSupport', () => ({
    useAutomationsSupport: () => ({ enabled: false }),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string, scope?: unknown) => {
        featureEnabledCalls.push({ featureId, scope });
        return featureId === 'sessions.direct' ? featureEnabledState.sessionsDirect : false;
    },
}));

vi.mock('@/components/sessions/new/modules/automationFeatureGate', () => ({
    resolveEffectiveAutomationDraft: ({ draft }: any) => draft,
    shouldShowAutomationActionChips: () => false,
}));

vi.mock('@/sync/domains/server/serverRuntime', () => ({
    getActiveServerSnapshot: () => ({ serverId: 's_active' }),
    subscribeActiveServer: (fn: any) => {
        fn({ serverId: 's_active' });
        return () => {};
    },
}));

vi.mock('@/components/sessions/new/modules/useNewSessionConnectedServices', () => ({
    useNewSessionConnectedServices: () => ({
        connectedServicesAuthChip: null,
    }),
}));

vi.mock('@/components/sessions/new/modules/profileHelpers', () => ({
    useProfileMap: (profiles: Array<{ id: string }>) => new Map(profiles.map((profile) => [profile.id, profile])),
    transformProfileToEnvironmentVars: () => [],
}));

vi.mock('@/components/sessions/new/hooks/newSessionModelModePolicy', () => ({
    resolveInitialNewSessionModelMode: () => 'default',
    coerceNewSessionModelMode: ({ modelMode }: any) => modelMode,
}));

vi.mock('@/sync/domains/settings/settings', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        settingsDefaults: testSettingsDefaults,
        isProfileCompatibleWithAnyAgent: (profile: any, agentIds: readonly string[]) =>
            profileCompatibilityState.isProfileCompatibleWithAnyAgent(profile, agentIds),
    };
});

vi.mock('@/sync/domains/profiles/profileCompatibility', async (importOriginal) => {
    const actual = await importOriginal<any>();
    return {
        ...actual,
        getProfileEnvironmentVariables: () => [],
        isProfileCompatibleWithAgent: (profile: any, agentId: string) =>
            profileCompatibilityState.isProfileCompatibleWithAgent(profile, agentId),
        isProfileCompatibleWithBackendTarget: (profile: any, target: any) =>
            profileCompatibilityState.isProfileCompatibleWithBackendTarget(profile, target),
    };
});

vi.mock('@/sync/domains/profiles/profileUtils', () => ({
    getBuiltInProfile: () => null,
    DEFAULT_PROFILES: [],
    getProfilePrimaryCli: () => null,
    isProfileEnabled: (profile: { id: string; defaultEnabled?: boolean }, profileEnabledById?: Record<string, boolean> | null) => {
        const override = profileEnabledById?.[profile.id];
        return typeof override === 'boolean' ? override : profile.defaultEnabled !== false;
    },
    getProfileSupportedAgentIds: (profile: any) => profileCompatibilityState.getProfileSupportedAgentIds(profile),
    isProfileCompatibleWithAnyAgent: (profile: any, agentIds: readonly string[]) =>
        profileCompatibilityState.isProfileCompatibleWithAnyAgent(profile, agentIds),
}));

vi.mock('@/agents/runtime/cliWarnings', () => ({
    applyCliWarningDismissal: () => ({}),
    isCliWarningDismissed: () => false,
}));

vi.mock('@/utils/secrets/secretSatisfaction', () => ({
    getSecretSatisfaction: () => ({ missingRequired: [], missingOptional: [] }),
}));

vi.mock('@/hooks/ui/useKeyboardHeight', () => ({
    useKeyboardHeight: () => 0,
}));

vi.mock('@/components/sessions/agentInput/inputMaxHeight', () => ({
    computeNewSessionInputMaxHeight: () => 100,
}));

vi.mock('@/components/sessions/new/newSessionScreenStyles', () => ({
    newSessionScreenStyles: {},
}));

vi.mock('@/components/sessions/new/hooks/serverTarget/useNewSessionServerTargetState', () => ({
    useNewSessionServerTargetState: () => ({
        serverProfiles: [],
        serverTargets: [],
        resolvedSettingsTarget: { allowedServerIds: [] },
        allowedTargetServerIds: [],
        targetServerId: 's1',
        targetServerProfile: null,
        targetServerName: null,
        showServerPickerChip: false,
        serverSelectionProps: {},
        resolveTargetServerId: () => 's1',
    }),
}));

vi.mock('@/components/sessions/new/hooks/screenModel/useNewSessionPreflightModelsState', () => ({
    useNewSessionPreflightModelsState: (params: { backendTarget: any }) => {
        const targetKey = buildBackendTargetKey(params.backendTarget);
        return {
            preflightModels: null,
            modelOptions: preflightModelOptionsByTargetKeyState.value[targetKey] ?? [],
            probe: { phase: 'idle', refresh: vi.fn() },
        };
    },
}));

vi.mock('@/components/sessions/new/hooks/screenModel/useNewSessionPreflightSessionModesState', () => ({
    useNewSessionPreflightSessionModesState: (params: { backendTarget: any }) => {
        const targetKey = buildBackendTargetKey(params.backendTarget);
        return {
            preflightModes: null,
            modeOptions: preflightSessionModeOptionsByTargetKeyState.value[targetKey] ?? [],
            probe: { phase: 'idle', refresh: vi.fn() },
        };
    },
}));

vi.mock('@/components/sessions/new/hooks/screenModel/useNewSessionPreflightConfigOptionsState', () => ({
    useNewSessionPreflightConfigOptionsState: (params: { backendTarget: any }) => {
        const targetKey = buildBackendTargetKey(params.backendTarget);
        return {
            configOptions: preflightConfigOptionsByTargetKeyState.value[targetKey] ?? null,
            probe: { phase: 'idle', refresh: vi.fn() },
        };
    },
}));

vi.mock('@/hooks/machine/useMachineEnvPresence', () => ({
    useMachineEnvPresence: () => ({ isPreviewEnvSupported: true, isLoading: false, meta: {}, refresh: vi.fn() }),
}));

vi.mock('@/components/sessions/new/hooks/useSecretRequirementFlow', () => ({
    useSecretRequirementFlow: () => ({
        suppressNextSecretAutoPromptKeyRef: { current: null },
        openSecretRequirementModal: vi.fn(),
        openSecretRequirementModalByKey: vi.fn(),
        selectedSecretIdByProfileIdByEnvVarName: {},
        setSelectedSecretIdByProfileIdByEnvVarName: vi.fn(),
        sessionOnlySecretValueByProfileIdByEnvVarName: {},
        setSessionOnlySecretValueByProfileIdByEnvVarName: vi.fn(),
        openSecretValueEdit: vi.fn(),
    }),
}));

vi.mock('@/utils/timing/runAfterInteractionsWithFallback', () => ({
    runAfterInteractionsWithFallback: (fn: () => void) => {
        fn();
        return undefined;
    },
}));

vi.mock('@/components/sessions/new/hooks/useNewSessionWizardProps', () => ({
    useNewSessionWizardProps: (params: any) => {
        React.useMemo(() => null, []);
        return {
            profiles: {
                selectedProfileId: params.selectedProfileId,
                onPressProfile: params.onPressProfile,
                getProfileDisabled: params.getProfileDisabled,
            },
            // Mirrors the real hook: the wizard-only sections exist only when the wizard is the
            // rendered variant.
            wizardSections: params.enabled
                ? {
                    layout: {},
                    agent: {
                        agentType: params.agentType,
                        agentLabel: params.agentLabel,
                    },
                    machine: {},
                    footer: {},
                }
                : null,
        };
    },
}));

const useNewSessionScreenModelModulePromise = import('./useNewSessionScreenModel');

describe('useNewSessionScreenModel (installables)', () => {
    beforeEach(() => {
        applySettingsMock.mockClear();
        modalShowMock.mockClear();
        modalAlertMock.mockClear();
        createSessionActionDraftMock.mockReset();
        handleCreateSessionMock.mockReset();
        agentInputActionChipActionIdsState.value = [];
        settingsRuntimeState.current = settingsState;
        settingsState.useEnhancedSessionWizard = false;
        settingsState.newSessionDefaultPersistenceModeV1 = 'persisted';
        settingsState.newSessionDefaultPersistenceModeByTargetKeyV1 = {};
        settingsState.useProfiles = false;
        settingsState.profiles = [];
        settingsState.codexBackendMode = 'acp';
        settingsState.sessionWindowsRemoteSessionLaunchMode = 'hidden';
        settingsState.lastUsedAgent = 'codex';
        settingsState.lastUsedPermissionMode = 'default';
        settingsState.sessionDefaultPermissionModeByTargetKey = {};
        settingsState.backendEnabledByTargetKey = {};
        storageStore.getState().activateProfileScope(TEST_DRAFT_SCOPE);
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [],
        };
        profileCompatibilityState.isProfileCompatibleWithAgent = () => true;
        profileCompatibilityState.isProfileCompatibleWithBackendTarget = () => true;
        profileCompatibilityState.isProfileCompatibleWithAnyAgent = () => true;
        profileCompatibilityState.getProfileSupportedAgentIds = () => [];
        persistedDraft.agentType = 'codex';
        persistedDraft.selectedProfileId = null;
        persistedDraft.selectedSecretId = null;
        persistedDraft.permissionMode = 'default';
        persistedDraft.modelMode = 'default';
        persistedDraft.acpSessionModeId = 'plan';
        persistedDraft.agentNewSessionOptionStateByAgentId = {};
        delete (persistedDraft as any).backendTarget;
        delete (persistedDraft as any).transcriptStorage;
        enabledAgentIdsState.value = ['codex', 'claude'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { codex: false, claude: true, opencode: null },
        };
        machineState.value = [
            { id: 'machine-1', metadata: { displayName: 'Machine One', host: 'one', homeDir: '/home/one' } },
        ];
        machineCapabilitiesResultsState.value = {
            'dep.codex-acp': {
                ok: true as const,
                checkedAt: Date.now(),
                data: {
                    installed: false,
                    installDir: '/tmp',
                    binPath: null,
                    installedVersion: null,
                    sourceKind: 'github_release_binary',
                    lastInstallLogPath: null,
                },
            },
        };
        pendingFireAndForget.length = 0;
        featureEnabledState.sessionsDirect = false;
        featureEnabledCalls.length = 0;
        preflightModelOptionsByTargetKeyState.value = {};
        preflightSessionModeOptionsByTargetKeyState.value = {};
        preflightConfigOptionsByTargetKeyState.value = {};
        chromeSafeAreaInsetsState.value = { top: 0, bottom: 0, left: 0, right: 0 };

    });

    it('renders without throwing during initial new-session screen model setup', async () => {
        const hook = await renderNewSessionScreenModel();
        expect(hook.getCurrent()).toBeTruthy();
    });

    it('keeps simple composer padding visual while the scaffold owns the safe-area inset', async () => {
        chromeSafeAreaInsetsState.value = { top: 12, bottom: 34, left: 0, right: 0 };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.safeAreaTop).toBe(12);
        expect(model?.simpleProps?.safeAreaBottom).toBe(34);
        expect(model?.simpleProps?.newSessionBottomPadding).toBe(8);
    });

    it('does not consult optional direct-session feature state for the core composer', async () => {
        await renderNewSessionScreenModel();

        expect(featureEnabledCalls.some((call) => call.featureId === 'sessions.direct')).toBe(false);
    });

    it('triggers background codex-acp install even when codex CLI is not detected', async () => {
        settingsState.experiments = true;

        const hook = await renderNewSessionScreenModel();
        let model = hook.getCurrent();

        await flushHookEffects();
        await Promise.allSettled(pendingFireAndForget);

        expect(model).toBeTruthy();
        expect(model?.variant).toBe('simple');
        expect(machineCapabilitiesInvoke).toHaveBeenCalledWith(
            'machine-1',
            expect.objectContaining({ id: 'dep.codex-acp', method: 'install' }),
            expect.anything(),
        );
    });

    it('falls back to default settings when settings are temporarily unavailable during startup', async () => {
        settingsRuntimeState.current = undefined;

        const hook = await renderNewSessionScreenModel();
        let model = hook.getCurrent();

        expect(model).toBeTruthy();
        expect(model?.variant).toBe('simple');
    });

    it('enables workspace and slash suggestions before a session exists', async () => {
        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.simpleProps?.emptyAutocompleteKinds).toEqual(['file', 'session', 'slashCommand']);
        const suggestions = await model?.simpleProps?.emptyAutocompleteSuggestions('/go');
        expect(suggestions?.some((suggestion: { text?: string }) => suggestion.text === '/goal')).toBe(true);
    });

    it('scopes the `@session` picker to the server this session will spawn on', async () => {
        // The kind being eligible is not the same fact as the host declaring its spawn target.
        // Without `serverId: targetServerId` the resolver has no server to scope to, so `@session`
        // silently offers nothing here — which is the whole affordance, and the assertion above
        // (an `emptyAutocompleteKinds` array plus a `/` query) cannot see it.
        const listed = (serverId: string, ids: readonly string[]) => ids.map((id) => ({
            type: 'session',
            serverId,
            session: {
                id,
                active: true,
                updatedAt: 10,
                metadata: { name: `Session ${id}`, path: '/repo' },
            },
        }));
        storageState.sessionListViewDataByServerId = {
            // `s1` is the mocked `targetServerId`; `s_active` is the active server, deliberately
            // different, so scoping to the wrong one is observable.
            s1: listed('s1', ['peer']),
            s_active: listed('s_active', ['elsewhere']),
        };

        try {
            const hook = await renderNewSessionScreenModel();
            const model = hook.getCurrent();

            const suggestions = await model?.simpleProps?.emptyAutocompleteSuggestions('@session:');

            expect(suggestions?.map((suggestion: { key?: string }) => suggestion.key)).toEqual(['session-peer']);
        } finally {
            storageState.sessionListViewDataByServerId = {};
        }
    });

    it('does not change hook order when the enhanced wizard flag toggles after mount', async () => {
        settingsState.useEnhancedSessionWizard = false;

        const hook = await renderNewSessionScreenModel();
        let model = hook.getCurrent();

        expect(model?.variant).toBe('simple');

        settingsState.useEnhancedSessionWizard = true;

        await hook.rerender();
        model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
    });

    it('does not offer other engines from a legacy enabled-agent list', async () => {
        settingsState.codexBackendMode = 'mcp';
        settingsState.lastUsedAgent = 'claude';
        persistedDraft.agentType = 'claude';
        enabledAgentIdsState.value = ['claude', 'codex', 'opencode'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, codex: false, opencode: true },
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not restore engine switching from legacy model previews', async () => {
        settingsState.codexBackendMode = 'mcp';
        settingsState.lastUsedAgent = 'claude';
        persistedDraft.agentType = 'claude';
        enabledAgentIdsState.value = ['claude', 'opencode'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, codex: false, opencode: true },
        };
        preflightModelOptionsByTargetKeyState.value = {
            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' })]: [
                { value: 'default', label: 'Claude default', description: 'Uses the backend default.' },
                { value: 'claude-3.7-sonnet', label: 'Claude 3.7 Sonnet', description: 'Balanced coding model.' },
            ],
            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'opencode' })]: [
                { value: 'default', label: 'OpenCode default', description: 'Uses the backend default.' },
                { value: 'opencode-fast', label: 'OpenCode Fast', description: 'Lower latency coding model.' },
            ],
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not expose ACP modes from a legacy backend', async () => {
        settingsState.lastUsedAgent = 'claude';
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'yes',
                        supportsModels: 'yes',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        enabledAgentIdsState.value = ['claude', 'customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, customAcp: false, codex: false, opencode: null },
        } as any;
        preflightSessionModeOptionsByTargetKeyState.value = {
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: [
                { id: 'plan', name: 'Plan', description: 'Structured planning mode.' },
                { id: 'review', name: 'Review', description: 'Review and critique mode.' },
            ],
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('keeps Codex controls when legacy backend mode choices exist', async () => {
        settingsState.lastUsedAgent = 'claude';
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'yes',
                        supportsModels: 'yes',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        enabledAgentIdsState.value = ['claude', 'customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, customAcp: false, codex: false, opencode: null },
        } as any;
        preflightModelOptionsByTargetKeyState.value = {
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: [
                { value: 'default', label: 'Preset default', description: 'Uses the backend default.' },
                { value: 'preset-fast', label: 'Preset Fast', description: 'Fast preset model.' },
            ],
        };
        preflightSessionModeOptionsByTargetKeyState.value = {
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: [
                { id: 'plan', name: 'Plan', description: 'Structured planning mode.' },
                { id: 'review', name: 'Review', description: 'Review and critique mode.' },
            ],
        };
        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not build a second engine picker from persisted options', async () => {
        settingsState.lastUsedAgent = 'claude';
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'yes',
                        supportsModels: 'yes',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        enabledAgentIdsState.value = ['claude', 'customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, customAcp: false, codex: false, opencode: null },
        } as any;

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not expose legacy ACP configuration previews', async () => {
        settingsState.lastUsedAgent = 'claude';
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'yes',
                        supportsModels: 'yes',
                        supportsConfigOptions: 'yes',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        enabledAgentIdsState.value = ['claude', 'customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, customAcp: false, codex: false, opencode: null },
        } as any;
        preflightConfigOptionsByTargetKeyState.value = {
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: [
                {
                    id: 'speed',
                    name: 'Speed',
                    type: 'select',
                    currentValue: 'standard',
                    options: [
                        { value: 'standard', name: 'Standard' },
                        { value: 'fast', name: 'Fast' },
                    ],
                },
            ],
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not restore ACP configuration controls', async () => {
        settingsState.lastUsedAgent = 'claude';
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'yes',
                        supportsModels: 'yes',
                        supportsConfigOptions: 'yes',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        enabledAgentIdsState.value = ['claude', 'customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, customAcp: false, codex: false, opencode: null },
        } as any;
        preflightConfigOptionsByTargetKeyState.value = {
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: [
                {
                    id: 'speed',
                    name: 'Speed',
                    type: 'select',
                    currentValue: 'standard',
                    options: [
                        { value: 'standard', name: 'Standard' },
                        { value: 'fast', name: 'Fast' },
                    ],
                },
            ],
        };
        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('keeps Codex when no CLI is selectable', async () => {
        settingsState.codexBackendMode = 'mcp';
        settingsState.lastUsedAgent = 'claude';
        persistedDraft.agentType = 'claude';
        enabledAgentIdsState.value = ['claude', 'codex'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: false, codex: false, opencode: null },
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('keeps the current agent when none are selectable and no valid fallback exists', async () => {
        settingsState.codexBackendMode = 'mcp';
        settingsState.lastUsedAgent = 'codex';
        persistedDraft.agentType = 'codex';
        enabledAgentIdsState.value = ['claude', 'codex'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: false, codex: false, opencode: null },
        };

        const hook = await renderNewSessionScreenModel();
        let model = hook.getCurrent();

        expect(model?.simpleProps?.agentType).toBe('codex');
    });

    it('uses per-agent permission defaults instead of the legacy last-used permission setting', async () => {
        settingsState.lastUsedPermissionMode = 'yolo';
        settingsState.sessionDefaultPermissionModeByTargetKey = {
            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'codex' })]: 'read-only',
        };
        delete (persistedDraft as { permissionMode?: string }).permissionMode;

        const hook = await renderNewSessionScreenModel();
        let model = hook.getCurrent();

        expect(model?.simpleProps?.permissionMode).toBe('read-only');
    });

    it('ignores a configured ACP backend when its CLI is unavailable', async () => {
        settingsState.lastUsedAgent = 'customAcp';
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'unknown',
                        supportsModels: 'unknown',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        settingsState.sessionDefaultPermissionModeByTargetKey = {
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: 'safe-yolo',
            [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'customAcp' })]: 'read-only',
        };
        persistedDraft.agentType = 'customAcp';
        delete (persistedDraft as { permissionMode?: string }).permissionMode;
        (persistedDraft as any).backendTarget = { kind: 'configuredAcpBackend', backendId: 'custom-preset' };
        persistedDraft.agentNewSessionOptionStateByAgentId = {};
        enabledAgentIdsState.value = ['customAcp', 'claude'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { customAcp: false, claude: true, codex: false, opencode: null },
        } as any;

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('falls back to Codex from a disabled configured ACP backend', async () => {
        settingsState.lastUsedAgent = 'claude';
        settingsState.backendEnabledByTargetKey = {
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: false,
        };
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'unknown',
                        supportsModels: 'unknown',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        persistedDraft.agentType = 'customAcp';
        (persistedDraft as any).backendTarget = { kind: 'configuredAcpBackend', backendId: 'custom-preset' };
        enabledAgentIdsState.value = ['claude', 'customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, customAcp: false, codex: false, opencode: null },
        } as any;

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('ignores a profile limited to a configured ACP backend', async () => {
        settingsState.useProfiles = true;
        settingsState.lastUsedAgent = 'claude';
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'unknown',
                        supportsModels: 'unknown',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        settingsState.profiles = [{
            id: 'profile-1',
            name: 'Profile One',
            environmentVariables: [],
            defaultPermissionModeByAgent: {},
            defaultPermissionModeByTargetKey: {},
            defaultPersistenceModeByAgent: {},
            defaultPersistenceModeByTargetKey: {},
            compatibility: {},
            compatibilityByTargetKey: {
                [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: true,
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' })]: false,
            },
            envVarRequirements: [],
            isBuiltIn: false,
            defaultEnabled: true,
            createdAt: 0,
            updatedAt: 0,
            version: '1.0.0',
        }] as any;
        profileCompatibilityState.isProfileCompatibleWithAnyAgent = () => false;
        profileCompatibilityState.isProfileCompatibleWithBackendTarget = (profile: any, target: any) =>
            profile?.compatibilityByTargetKey?.[buildBackendTargetKey(target)] ?? false;
        persistedDraft.agentType = 'claude';
        persistedDraft.selectedProfileId = 'profile-1';
        (persistedDraft as any).backendTarget = { kind: 'builtInAgent', agentId: 'claude' };
        enabledAgentIdsState.value = ['claude', 'customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, customAcp: false, codex: false, opencode: null },
        } as any;

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not select a different engine for legacy profile authentication', async () => {
        settingsState.useEnhancedSessionWizard = true;
        settingsState.useProfiles = true;
        settingsState.lastUsedAgent = 'codex';
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset',
                    name: 'custom-preset',
                    title: 'Custom Preset',
                    command: 'custom-acp',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'unknown',
                        supportsModels: 'unknown',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
            ],
        };
        settingsState.profiles = [{
            id: 'profile-1',
            name: 'Profile One',
            environmentVariables: [],
            defaultPermissionModeByAgent: {},
            defaultPermissionModeByTargetKey: {},
            defaultPersistenceModeByAgent: {},
            defaultPersistenceModeByTargetKey: {},
            compatibility: {},
            compatibilityByTargetKey: {
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' })]: true,
                [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset' })]: true,
            },
            envVarRequirements: [],
            isBuiltIn: false,
            createdAt: 0,
            updatedAt: 0,
            version: '1.0.0',
        }] as any;
        profileCompatibilityState.isProfileCompatibleWithAnyAgent = () => true;
        profileCompatibilityState.isProfileCompatibleWithBackendTarget = (profile: any, target: any) =>
            profile?.compatibilityByTargetKey?.[buildBackendTargetKey(target)] ?? false;
        persistedDraft.agentType = 'codex';
        persistedDraft.selectedProfileId = null;
        enabledAgentIdsState.value = ['claude', 'codex', 'customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, customAcp: false, codex: false, opencode: null },
            authStatus: {
                claude: { state: 'logged_out', checkedAt: 1 },
            },
        } as any;

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('ignores an incompatible legacy profile', async () => {
        settingsState.useEnhancedSessionWizard = true;
        settingsState.useProfiles = true;
        settingsState.lastUsedAgent = 'codex';
        settingsState.profiles = [{
            id: 'profile-1',
            name: 'Profile One',
            environmentVariables: [],
            defaultPermissionModeByAgent: {},
            defaultPermissionModeByTargetKey: {},
            defaultPersistenceModeByAgent: {},
            defaultPersistenceModeByTargetKey: {},
            compatibility: {},
            compatibilityByTargetKey: {
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'claude' })]: true,
                [buildBackendTargetKey({ kind: 'builtInAgent', agentId: 'gemini' })]: true,
            },
            envVarRequirements: [],
            isBuiltIn: false,
            createdAt: 0,
            updatedAt: 0,
            version: '1.0.0',
        }] as any;
        profileCompatibilityState.isProfileCompatibleWithAnyAgent = () => true;
        profileCompatibilityState.isProfileCompatibleWithBackendTarget = (profile: any, target: any) =>
            profile?.compatibilityByTargetKey?.[buildBackendTargetKey(target)] ?? false;
        persistedDraft.agentType = 'codex';
        persistedDraft.selectedProfileId = null;
        enabledAgentIdsState.value = ['claude', 'codex', 'gemini'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, codex: false, gemini: true, opencode: null },
            authStatus: {
                claude: { state: 'logged_out', checkedAt: 1 },
                gemini: { state: 'logged_out', checkedAt: 1 },
            },
        } as any;

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('omits engine switching even when many agents are available', async () => {
        settingsState.codexBackendMode = 'mcp';
        settingsState.lastUsedAgent = 'claude';
        persistedDraft.agentType = 'claude';
        enabledAgentIdsState.value = ['claude', 'codex', 'opencode', 'gemini'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { claude: true, codex: true, opencode: true, gemini: true },
        } as any;

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not expose direct-storage selection from old preferences', async () => {
        featureEnabledState.sessionsDirect = true;
        settingsState.lastUsedAgent = 'codex';
        settingsState.newSessionDefaultPersistenceModeV1 = 'persisted';
        settingsState.newSessionDefaultPersistenceModeByTargetKeyV1 = {};
        persistedDraft.agentType = 'codex';
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { codex: true, claude: true, opencode: true },
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('omits execution-run action chips from new sharing sessions', async () => {
        agentInputActionChipActionIdsState.value = ['review.start'];

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('ignores old direct-storage defaults in the core composer', async () => {
        featureEnabledState.sessionsDirect = true;
        settingsState.lastUsedAgent = 'codex';
        settingsState.newSessionDefaultPersistenceModeV1 = 'direct';
        settingsState.newSessionDefaultPersistenceModeByTargetKeyV1 = {};
        settingsState.useProfiles = false;
        settingsState.profiles = [];
        persistedDraft.agentType = 'codex';
        persistedDraft.selectedProfileId = null;
        delete (persistedDraft as any).transcriptStorage;
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { codex: true, claude: true, opencode: true },
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not restore profile storage controls', async () => {
        featureEnabledState.sessionsDirect = true;
        settingsState.lastUsedAgent = 'codex';
        settingsState.newSessionDefaultPersistenceModeV1 = 'persisted';
        settingsState.newSessionDefaultPersistenceModeByTargetKeyV1 = { 'agent:codex': 'persisted' };
        settingsState.useProfiles = true;
        settingsState.profiles = [{
            id: 'profile-1',
            name: 'Profile One',
            environmentVariables: [],
            defaultPermissionModeByAgent: {},
            defaultPermissionModeByTargetKey: {},
            defaultPersistenceModeByAgent: {},
            defaultPersistenceModeByTargetKey: { 'agent:codex': 'direct' },
            compatibility: { codex: true, claude: true, gemini: true },
            compatibilityByTargetKey: {},
            envVarRequirements: [],
            isBuiltIn: false,
            defaultEnabled: true,
            createdAt: 0,
            updatedAt: 0,
            version: '1.0.0',
        }];
        persistedDraft.agentType = 'codex';
        persistedDraft.selectedProfileId = 'profile-1';
        delete (persistedDraft as any).transcriptStorage;
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { codex: true, claude: true, opencode: true },
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('does not restore a configured ACP storage picker', async () => {
        featureEnabledState.sessionsDirect = true;
        settingsState.lastUsedAgent = 'customAcp';
        settingsState.newSessionDefaultPersistenceModeV1 = 'persisted';
        settingsState.newSessionDefaultPersistenceModeByTargetKeyV1 = {
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset-a' })]: 'persisted',
            [buildBackendTargetKey({ kind: 'configuredAcpBackend', backendId: 'custom-preset-b' })]: 'direct',
        };
        settingsState.acpCatalogSettingsV1 = {
            v: 2,
            backends: [
                {
                    id: 'custom-preset-a',
                    name: 'custom-preset-a',
                    title: 'Custom Preset A',
                    command: 'custom-acp-a',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'unknown',
                        supportsModels: 'unknown',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                },
                {
                    id: 'custom-preset-b',
                    name: 'custom-preset-b',
                    title: 'Custom Preset B',
                    command: 'custom-acp-b',
                    args: ['serve'],
                    env: {},
                    transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'unknown',
                        supportsModels: 'unknown',
                        supportsConfigOptions: 'unknown',
                        promptImageSupport: 'unknown',
                    },
                    createdAt: 2,
                    updatedAt: 2,
                },
            ],
        };
        persistedDraft.agentType = 'customAcp';
        (persistedDraft as any).backendTarget = { kind: 'configuredAcpBackend', backendId: 'custom-preset-a' };
        enabledAgentIdsState.value = ['customAcp'];
        cliAvailabilityState.value = {
            timestamp: 1,
            available: { customAcp: false, codex: false, claude: false, opencode: null },
        } as any;
        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('keeps core controls on Windows without a separate session-mode picker', async () => {
        machineState.value = [
            {
                id: 'machine-1',
                metadata: {
                    displayName: 'Machine One',
                    host: 'one',
                    homeDir: '/home/one',
                    platform: 'win32',
                    windowsRemoteSessionLaunchMode: 'console',
                },
            },
        ];
        settingsState.sessionWindowsRemoteSessionLaunchMode = 'hidden';
        machineCapabilitiesResultsState.value = {
            ...machineCapabilitiesResultsState.value,
            'tool.windowsTerminal': {
                ok: true as const,
                checkedAt: Date.now(),
                data: {
                    available: true,
                    resolvedPath: 'C:\\Program Files\\WindowsApps\\wt.exe',
                },
            },
        };

        const hook = await renderNewSessionScreenModel();
        const model = hook.getCurrent();

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(model?.simpleProps?.agentInputExtraActionChips).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.showResumePicker).toBe(false);
    });

    it('addresses the file search at the machine and folder the user picked', async () => {
        machineRpcWithServerScopeMock.mockReset();
        machineRpcWithServerScopeMock.mockResolvedValue({ success: true, stdout: 'README.md\nsrc/index.ts\n' });
        const { fileSearchCache } = await import('@/sync/domains/input/suggestionFile');
        fileSearchCache.clearAll();

        try {
            const hook = await renderNewSessionScreenModel();
            const model = hook.getCurrent();

            const suggestions = await model?.simpleProps?.emptyAutocompleteSuggestions('@REA');
            expect(suggestions?.some((suggestion: { text?: string }) => suggestion.text === '@README.md')).toBe(true);

            const ripgrep = machineRpcWithServerScopeMock.mock.calls
                .map(([params]) => params as { machineId: string; method: string; payload: { cwd?: string } })
                .filter((params) => params.method === 'ripgrep');
            expect(ripgrep).toHaveLength(1);
            expect(ripgrep[0]?.machineId).toBe('machine-1');
            expect(ripgrep[0]?.payload.cwd).toBe('/repo');
        } finally {
            fileSearchCache.clearAll();
        }
    });

});
