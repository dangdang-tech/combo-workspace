import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, renderScreen, standardCleanup } from '@/dev/testkit';
import { buildRememberedEngineSelectionScopeKey } from '@/sync/domains/sessionAuthoring/rememberedEngineSelections';

import {
    activeServerAccountScopeState,
    allMachinesState,
    cliDetectionState,
    clearNewSessionDraftMock,
    computeNewSessionInputMaxHeightMock,
    featureFlags,
    flushInteractionQueue,
    loadNewSessionDraftMock,
    makeTestAutomationDraft,
    makeTestProfile,
    makeTestWorkspace,
    makeTestWorkspaceCheckout,
    makeTestWorkspaceLocation,
    modalShowMock,
    persistDraftNowRef,
    persistedDraft,
    platformOsState,
    renderNewSessionScreenModel,
    replaceRepositoryDraftFromPersistedFixture,
    resetDraftPersistenceState,
    routerPushMock,
    runFocusEffectsAndSettle,
    saveNewSessionDraftMock,
    searchParamsState,
    settingsState,
    tempSessionDataState,
    targetServerState,
    useCreateNewSessionArgsRef,
    useNewSessionScreenModelModulePromise,
    workspaceGraphState,
} from './__tests__/draftPersistenceTestEnvironment';

async function installActiveServerTargetFixture(serverIds = ['a', 'b', 'c']): Promise<void> {
    const sourceModule = await import('./serverTarget/useNewSessionActiveServerSource');
    const targetModule = await import('./serverTarget/useNewSessionServerTargetState');
    const realTargetModule = await vi.importActual<typeof targetModule>('./serverTarget/useNewSessionServerTargetState');
    vi.spyOn(sourceModule, 'useNewSessionActiveServerSource').mockReturnValue({
        activeServerId: 'server-a',
        serverProfilesSignature: `draft-core:${serverIds.join(',')}`,
        serverProfiles: serverIds.map((id) => ({
            id: `server-${id}`, name: `Server ${id}`, serverUrl: `https://${id}.example.test`,
            createdAt: 1, updatedAt: 1, lastUsedAt: 1,
        })),
    });
    vi.spyOn(targetModule, 'useNewSessionServerTargetState').mockImplementation(realTargetModule.useNewSessionServerTargetState);
}

// Slim core suite for cross-cutting draft hydration invariants. Domain-specific
// behavior lives in the `.path.test.tsx`, `.machine.test.tsx`, and
// `.checkout.test.tsx` sibling files. Shared mock graph + hoisted state lives
// in `__tests__/draftPersistenceTestEnvironment.ts`.
describe('useNewSessionScreenModel (draft hydration — core)', () => {
    afterEach(() => {
        standardCleanup();
        vi.restoreAllMocks();
    });

    beforeEach(async () => {
        await resetDraftPersistenceState();
    });

    it('does not hydrate remembered Claude plan mode into the core Codex composer', async () => {
        const scopeKey = buildRememberedEngineSelectionScopeKey({
            serverId: null,
            backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        });
        settingsState.rememberLastEngineSelectionsV1 = true;
        settingsState.lastEngineSelectionsByScopeV1 = {
            [scopeKey]: { modelId: null, acpSessionModeId: 'plan', sessionConfigOptionOverrides: null, updatedAt: 1 },
        };
        persistedDraft.backendTarget = { kind: 'builtInAgent', agentId: 'claude' };
        persistedDraft.acpSessionModeId = 'plan';
        await renderNewSessionScreenModel(() => {});
        expect(useCreateNewSessionArgsRef.current?.agentType).toBe('codex');
        expect(useCreateNewSessionArgsRef.current?.acpSessionModeId).toBeNull();
        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({
            agentId: 'codex', acpSessionModeId: null,
        }));
    });

    it('drops a persisted Claude model when a route-selected Codex backend owns the new session', async () => {
        searchParamsState.value = {
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
        };
        persistedDraft.agentType = 'claude';
        persistedDraft.backendTarget = { kind: 'builtInAgent', agentId: 'claude' };
        persistedDraft.modelMode = 'claude-opus-4-8';

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.modelMode).toBe('default');
        expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
            authoringDraft: expect.objectContaining({
                backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                modelId: null,
            }),
        }));
    });

    it('preserves draft permission, prompt, and path while normalizing its backend options', async () => {
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.permissionMode).toBe('yolo');
        expect(model?.simpleProps?.promptStore.getPrompt()).toBe('hello');
        expect(model?.simpleProps?.acpSessionModeId).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.acpSessionModeId).toBeNull();
        expect(model?.simpleProps?.acpConfigOptionOverrides).toBeNull();
        expect(model?.simpleProps?.machineName).toBe('Machine Two');
        expect(typeof model?.simpleProps?.machinePopover?.renderContent).toBe('function');
        expect(model?.simpleProps?.selectedPath).toBe('/repo/custom');
        await act(async () => { persistDraftNowRef.current?.(); });
        expect(saveNewSessionDraftMock).toHaveBeenCalledWith(expect.objectContaining({
            input: 'hello', selectedMachineId: 'machine-2', selectedPath: '/repo/custom', permissionMode: 'yolo',
            sessionConfigOptionOverrides: null,
        }));
    });

    it('rehydrates and durably updates the principal launch user-attempt id', async () => {
        persistedDraft.launchUserAttemptId = 'opaque-attempt-a';
        await renderNewSessionScreenModel(() => {});

        expect(useCreateNewSessionArgsRef.current?.launchUserAttemptId).toBe('opaque-attempt-a');
        expect(useCreateNewSessionArgsRef.current?.launchIntentSignature).toEqual(expect.any(String));
        const updateAttempt = useCreateNewSessionArgsRef.current?.onLaunchUserAttemptIdChange;
        expect(updateAttempt).toEqual(expect.any(Function));

        await act(async () => {
            (updateAttempt as (value: string | null) => void)('opaque-attempt-b');
        });
        expect(saveNewSessionDraftMock).toHaveBeenLastCalledWith(
            expect.objectContaining({ launchUserAttemptId: 'opaque-attempt-b' }),
        );
    });

    it('ignores old continuation recipes when composing a new core session', async () => {
        searchParamsState.value = { dataId: 'source-context-a' };
        const sourceContextA = {
            v: 1 as const,
            kind: 'session_replay' as const,
            sourceSessionId: 'source-session-a',
            forkPoint: { type: 'seq' as const, upToSeqInclusive: 12 },
        };
        tempSessionDataState.value = {
            sourceContext: sourceContextA,
            sourceContextServerId: 'server-a',
        };

        const hook = await renderNewSessionScreenModel(() => {});
        const signatureForSourceA = useCreateNewSessionArgsRef.current?.launchIntentSignature;
        expect(signatureForSourceA).toEqual(expect.any(String));
        expect(useCreateNewSessionArgsRef.current?.sourceContext).toBeNull();

        searchParamsState.value = { dataId: 'source-context-b' };
        const sourceContextB = {
            ...sourceContextA,
            sourceSessionId: 'source-session-b',
        };
        tempSessionDataState.value = {
            sourceContext: sourceContextB,
            sourceContextServerId: 'server-a',
        };
        await hook.rerender();

        const signatureForSourceB = useCreateNewSessionArgsRef.current?.launchIntentSignature;
        expect(signatureForSourceB).toEqual(expect.any(String));
        expect(signatureForSourceB).toBe(signatureForSourceA);
        expect(useCreateNewSessionArgsRef.current?.sourceContext).toBeNull();
    });

    it('uses the active server despite a persisted target server', async () => {
        await installActiveServerTargetFixture();
        targetServerState.allowedTargetServerIds = ['server-a', 'server-b'];
        persistedDraft.targetServerId = 'server-b';

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.targetServerId).toBe('server-a');
    });

    it('keeps the active server despite route and persisted target servers', async () => {
        await installActiveServerTargetFixture();
        targetServerState.allowedTargetServerIds = ['server-a', 'server-b', 'server-c'];
        persistedDraft.targetServerId = 'server-b';
        searchParamsState.value = { spawnServerId: 'server-c' };

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.targetServerId).toBe('server-a');
    });

    it('ignores an unavailable persisted target server', async () => {
        await installActiveServerTargetFixture(['a']);
        targetServerState.allowedTargetServerIds = ['server-a'];
        persistedDraft.targetServerId = 'server-b';

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.targetServerId).not.toBe('server-b');
    });

    it('persists the active server with the launch draft', async () => {
        await installActiveServerTargetFixture();
        targetServerState.allowedTargetServerIds = ['server-a', 'server-b'];
        targetServerState.targetServerId = 'server-b';

        await renderNewSessionScreenModel(() => {});

        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock).toHaveBeenCalledWith(expect.objectContaining({
            targetServerId: 'server-a',
        }));
    });

    it('hydrates and persists a Windows remote launch override for the matching machine', async () => {
        allMachinesState.value = [
            { id: 'machine-1', metadata: { displayName: 'Machine One', host: 'one', homeDir: '/home/one', happyHomeDir: '/home/one', happyCliVersion: '1.0.0', platform: 'darwin' } },
            { id: 'machine-2', metadata: { displayName: 'Machine Two', host: 'two', homeDir: '/home/two', happyHomeDir: '/home/two', happyCliVersion: '1.0.0', platform: 'win32' } },
        ];
        persistedDraft.windowsRemoteSessionLaunchModeOverride = {
            machineId: 'machine-2',
            mode: 'windows_terminal',
        };

        await renderNewSessionScreenModel(() => {});

        expect(useCreateNewSessionArgsRef.current?.windowsRemoteSessionLaunchModeOverride).toBe('windows_terminal');

        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock).toHaveBeenCalledWith(expect.objectContaining({
            windowsRemoteSessionLaunchModeOverride: {
                machineId: 'machine-2',
                mode: 'windows_terminal',
            },
        }));
    });

    it('ignores a persisted Windows remote launch override for a different machine', async () => {
        allMachinesState.value = [
            { id: 'machine-1', metadata: { displayName: 'Machine One', host: 'one', homeDir: '/home/one', happyHomeDir: '/home/one', happyCliVersion: '1.0.0', platform: 'win32' } },
            { id: 'machine-2', metadata: { displayName: 'Machine Two', host: 'two', homeDir: '/home/two', happyHomeDir: '/home/two', happyCliVersion: '1.0.0', platform: 'win32' } },
        ];
        persistedDraft.windowsRemoteSessionLaunchModeOverride = {
            machineId: 'machine-1',
            mode: 'windows_terminal',
        };

        await renderNewSessionScreenModel(() => {});

        expect(useCreateNewSessionArgsRef.current?.windowsRemoteSessionLaunchModeOverride).toBeNull();

        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock.mock.calls.at(-1)?.[0]).not.toEqual(expect.objectContaining({
            windowsRemoteSessionLaunchModeOverride: expect.anything(),
        }));
    });

    it('clears the Windows remote launch override from persisted drafts after the user changes machines', async () => {
        allMachinesState.value = [
            { id: 'machine-1', metadata: { displayName: 'Machine One', host: 'one', homeDir: '/home/one', happyHomeDir: '/home/one', happyCliVersion: '1.0.0', platform: 'win32' } },
            { id: 'machine-2', metadata: { displayName: 'Machine Two', host: 'two', homeDir: '/home/two', happyHomeDir: '/home/two', happyCliVersion: '1.0.0', platform: 'win32' } },
        ];
        persistedDraft.windowsRemoteSessionLaunchModeOverride = {
            machineId: 'machine-2',
            mode: 'windows_terminal',
        };

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        const content = model?.simpleProps?.machinePopover?.renderContent({ requestClose: vi.fn() });
        const machineSelectionContent = content as React.ReactElement<{
            onSelectMachine: (machine: { id: string; metadata: { displayName: string; host: string; homeDir: string; happyHomeDir: string; happyCliVersion: string; platform: string } }) => void;
        }>;
        await act(async () => {
            machineSelectionContent.props.onSelectMachine({
                id: 'machine-1',
                metadata: { displayName: 'Machine One', host: 'one', homeDir: '/home/one', happyHomeDir: '/home/one', happyCliVersion: '1.0.0', platform: 'win32' },
            });
            await flushHookEffects({ cycles: 1, turns: 2 });
        });

        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock.mock.calls.at(-1)?.[0]).not.toEqual(expect.objectContaining({
            windowsRemoteSessionLaunchModeOverride: expect.anything(),
        }));
    });

    it('defers machine popover close after selection on web to avoid click fall-through', async () => {
        vi.useFakeTimers();
        try {
            let model: any = null;
            await renderNewSessionScreenModel((nextModel) => {
                model = nextModel;
            });

            const requestClose = vi.fn();
            const content = model?.simpleProps?.machinePopover?.renderContent({ requestClose });
            expect(React.isValidElement(content)).toBe(true);

            await act(async () => {
                (content as React.ReactElement<any>).props.onSelectMachine({
                    id: 'machine-1',
                    metadata: { displayName: 'Machine One', host: 'one', homeDir: '/home/one' },
                });
            });

            expect(requestClose).not.toHaveBeenCalled();

            await act(async () => {
                vi.runOnlyPendingTimers();
            });

            expect(requestClose).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('leaves live composer panel height ownership to the keyboard scaffold', async () => {
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.sessionPromptInputMaxHeight).toBeUndefined();
        expect(computeNewSessionInputMaxHeightMock).not.toHaveBeenCalled();
    });

    it('keeps simple-panel hot-path props stable across unchanged rerenders', async () => {
        let model: any = null;
        const hook = await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });
        const firstProps = model?.simpleProps;

        await hook.rerender();
        const secondProps = model?.simpleProps;

        expect(secondProps?.modelOptionsProbe).toBe(firstProps?.modelOptionsProbe);
        expect(secondProps?.acpSessionModeProbe).toBe(firstProps?.acpSessionModeProbe);
        expect(secondProps?.acpConfigOptionsProbe).toBe(firstProps?.acpConfigOptionsProbe);
        expect(secondProps?.connectionStatus).toBe(firstProps?.connectionStatus);
        expect(secondProps?.machinePopover).toBe(firstProps?.machinePopover);
        expect(secondProps?.pathPopover).toBe(firstProps?.pathPopover);
        expect(secondProps?.agentInputExtraActionChips).toBe(firstProps?.agentInputExtraActionChips);

        allMachinesState.value = allMachinesState.value.map((machine) => (
            machine?.id === 'machine-2'
                ? { ...machine, activeAt: 456 }
                : machine
        ));
        await hook.rerender();

        expect(model?.simpleProps?.machinePopover).toBe(firstProps?.machinePopover);

        await hook.unmount();
    });

    it('keeps the default attachment flow id stable across new-session route remounts', async () => {
        let firstModel: any = null;
        const firstHook = await renderNewSessionScreenModel((nextModel) => {
            firstModel = nextModel;
        });
        const firstAttachmentFlowId = firstModel?.simpleProps?.attachmentFlowId;
        expect(typeof firstAttachmentFlowId).toBe('string');
        expect(firstAttachmentFlowId.length).toBeGreaterThan(0);

        await firstHook.unmount();

        let secondModel: any = null;
        const secondHook = await renderNewSessionScreenModel((nextModel) => {
            secondModel = nextModel;
        });

        expect(secondModel?.simpleProps?.attachmentFlowId).toBe(firstAttachmentFlowId);

        await secondHook.unmount();
    });

    it('keeps the removed agent picker absent when CLI detection refreshes', async () => {
        let model: any = null;
        const hook = await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });
        const firstProbe = model?.simpleProps?.agentPickerProbe;
        const firstAgentPickerOptions = model?.simpleProps?.agentPickerOptions;
        const firstHandleAgentClick = model?.simpleProps?.handleAgentClick;
        const firstHandleAgentPickerSelect = model?.simpleProps?.onAgentPickerSelect;

        cliDetectionState.value = {
            ...cliDetectionState.value,
            timestamp: cliDetectionState.value.timestamp + 1,
            refresh: vi.fn(),
        };
        await hook.rerender();

        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.agentPickerProbe).toBe(firstProbe);
        expect(model?.simpleProps?.agentPickerOptions).toBe(firstAgentPickerOptions);
        expect(model?.simpleProps?.handleAgentClick).toBe(firstHandleAgentClick);
        expect(model?.simpleProps?.onAgentPickerSelect).toBe(firstHandleAgentPickerSelect);

        await hook.unmount();
    });

    it('selects Codex without an engine picker when the route and draft remember Claude', async () => {
        searchParamsState.value = { agentType: 'claude' };
        persistedDraft.agentType = 'claude';
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.agentPickerOptions).toBeUndefined();
        expect(model?.simpleProps?.onAgentPickerSelect).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.backendTarget).toEqual({ kind: 'builtInAgent', agentId: 'codex' });
    });

    it('keeps the active server and draft path without restoring scoped worktree intent', async () => {
        await installActiveServerTargetFixture();
        targetServerState.allowedTargetServerIds = ['server-a', 'server-b'];
        targetServerState.targetServerId = 'server-b';
        targetServerState.targetServerName = 'Server B';
        persistedDraft.selectedWorkspaceId = 'ws_payments';
        persistedDraft.selectedWorkspaceLocationId = 'loc_local';
        persistedDraft.selectedWorkspaceCheckoutId = null as any;
        persistedDraft.checkoutCreationDraft = {
            kind: 'git_worktree',
            displayName: 'feature/first-render-fix',
            baseRef: 'main',
        };

        workspaceGraphState.workspacesByServerId['server-b'] = [
            makeTestWorkspace({
                id: 'ws_payments',
                displayName: 'Payments',
                locationIds: ['loc_local'],
                defaultLocationId: 'loc_local',
            }),
        ];

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(loadNewSessionDraftMock).toHaveBeenCalled();
        expect(model?.simpleProps?.selectedWorkspaceId).toBeUndefined();
        expect(model?.simpleProps?.selectedWorkspaceLocationId).toBeUndefined();
        expect(model?.simpleProps?.selectedWorkspaceCheckoutId).toBeUndefined();
        expect(model?.simpleProps?.checkoutCreationDraft).toBeNull();
        expect(model?.simpleProps?.selectedPath).toBe('/repo/custom');
        expect(useCreateNewSessionArgsRef.current?.targetServerId).toBe('server-a');
        expect(model?.simpleProps?.agentInputExtraActionChips ?? []).toEqual([]);
    });

    it('infers linked workspace context on first render when the selected path already belongs to a workspace', async () => {
        persistedDraft.selectedWorkspaceId = null as any;
        persistedDraft.selectedWorkspaceLocationId = null as any;
        persistedDraft.selectedWorkspaceCheckoutId = null as any;
        persistedDraft.checkoutCreationDraft = null;

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.selectedWorkspaceId).toBeUndefined();
        expect(model?.simpleProps?.selectedWorkspaceLocationId).toBeUndefined();
        expect(model?.simpleProps?.selectedWorkspaceCheckoutId).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
            authoringDraft: expect.objectContaining({
                checkoutCreationDraft: null,
            }),
        }));
    });

    it('keeps ordinary submit semantics even when the draft enables automation', async () => {
        featureFlags.automationsEnabled = true;
        persistedDraft.automationDraft = makeTestAutomationDraft({ enabled: true, name: 'Daily summary' });
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.submitAccessibilityLabel).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({ automation: null }));
    });

    it('ignores stale automation fields and an old automation create route', async () => {
        featureFlags.automationsEnabled = true;
        persistedDraft.automationDraft = makeTestAutomationDraft({
            enabled: true,
            name: 'Legacy automation',
            description: 'Carryover description',
            everyMinutes: 90,
            timezone: 'Europe/Zurich',
        });
        searchParamsState.value = { automation: '1' };
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.submitAccessibilityLabel).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({ automation: null }));
        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock).toHaveBeenCalledWith(expect.objectContaining({
            input: 'hello',
        }));
    });

    it('keeps ordinary submission across focus after an old automation route', async () => {
        featureFlags.automationsEnabled = true;
        persistedDraft.automationDraft = makeTestAutomationDraft();
        searchParamsState.value = { automation: '1' };
        let model: any = null;
        const hook = await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.submitAccessibilityLabel).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({ automation: null }));

        searchParamsState.value = {};
        persistedDraft.automationDraft = makeTestAutomationDraft();
        persistedDraft.entryIntent = 'automation';
        persistedDraft.updatedAt = 456;
        await replaceRepositoryDraftFromPersistedFixture();

        await hook.rerender();
        const cleanups = await runFocusEffectsAndSettle();
        for (const cleanup of cleanups) {
            if (typeof cleanup === 'function') cleanup();
        }

        expect(model?.simpleProps?.submitAccessibilityLabel).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({ automation: null }));
        expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
            authoringDraft: expect.objectContaining({ automation: null }),
        }));
    });

    it('does not restore automation after autosaving and remounting an old automation route', async () => {
        featureFlags.automationsEnabled = true;
        persistedDraft.automationDraft = makeTestAutomationDraft();
        searchParamsState.value = { automation: '1' };

        let automationRouteModel: any = null;
        let plainRouteModel: any = null;
        const automationRouteHook = await renderNewSessionScreenModel((nextModel) => {
            automationRouteModel = nextModel;
        });

        expect(automationRouteModel?.simpleProps?.submitAccessibilityLabel).toBeUndefined();

        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock.mock.calls.at(-1)?.[0]?.automationDraft?.enabled).not.toBe(true);
        expect(useCreateNewSessionArgsRef.current?.automationEditId).toBeNull();

        persistedDraft.automationDraft = makeTestAutomationDraft({ enabled: true });
        persistedDraft.entryIntent = 'automation';
        persistedDraft.updatedAt = 456;
        searchParamsState.value = {};

        await automationRouteHook.unmount();
        await replaceRepositoryDraftFromPersistedFixture();
        await renderNewSessionScreenModel((nextModel) => {
            plainRouteModel = nextModel;
        });

        expect(plainRouteModel?.simpleProps?.submitAccessibilityLabel).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
            authoringDraft: expect.objectContaining({
                automation: null,
            }),
        }));
    });

    it('preserves a temp automation seed prompt and directory as an ordinary new session', async () => {
        settingsState.useProfiles = true;
        searchParamsState.value = {
            dataId: 'temp-edit-seed',
            automation: '1',
            automationEditId: 'auto-1',
        };
        tempSessionDataState.value = {
            prompt: 'Review the open pull requests',
            machineId: 'machine-1',
            path: '/repo/edit-seed',
            agentType: 'codex',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            codexBackendMode: 'appServer',
            transcriptStorage: 'direct',
            permissionMode: 'acceptEdits',
            automationDraft: makeTestAutomationDraft({
                enabled: true,
                name: 'PR review',
                description: 'Nightly review',
                everyMinutes: 30,
            }),
        };

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.selectedPath).toBe('/repo/edit-seed');
        expect(model?.simpleProps?.permissionMode).toBe('acceptEdits');
        expect(model?.simpleProps?.submitAccessibilityLabel).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({ automation: null }));
        expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
            authoringDraft: expect.objectContaining({
                directory: '/repo/edit-seed',
                backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
                prompt: 'Review the open pull requests',
                displayText: 'Review the open pull requests',
            }),
        }));

        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock).toHaveBeenCalledWith(expect.objectContaining({
            input: 'Review the open pull requests',
            selectedMachineId: 'machine-1',
            selectedPath: '/repo/edit-seed',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            permissionMode: 'acceptEdits',

        }));
    });

    it('lets contextual temp seed data replace persisted selections while preserving draft content', async () => {
        searchParamsState.value = {
            dataId: 'session-config-seed',
        };
        persistedDraft.input = 'Persisted prompt';
        persistedDraft.selectedMachineId = 'machine-2';
        persistedDraft.selectedPath = '/repo/persisted';
        persistedDraft.agentType = 'claude';
        persistedDraft.permissionMode = 'yolo';
        persistedDraft.resumeSessionId = 'resume-persisted';
        tempSessionDataState.value = {
            prompt: '',
            machineId: 'machine-1',
            directory: '/repo/from-session',
            agentType: 'codex',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            permissionMode: 'acceptEdits',
            modelMode: 'gpt-5',
            acpSessionModeId: 'plan',
            replacePersistedDraftSelections: true,
        };

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.promptStore.getPrompt()).toBe('Persisted prompt');
        expect(model?.simpleProps?.agentType).toBe('codex');
        expect(model?.simpleProps?.permissionMode).toBe('acceptEdits');
        expect(model?.simpleProps?.selectedPath).toBe('/repo/from-session');
        expect(model?.simpleProps?.machineName).toBe('Machine One');
        expect(model?.simpleProps?.resumeSessionId).toBe('');
        expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
            authoringDraft: expect.objectContaining({
                prompt: 'Persisted prompt',
                displayText: 'Persisted prompt',
                agentId: 'codex',
                permissionMode: 'acceptEdits',
                modelId: 'gpt-5',
                acpSessionModeId: null,
                resumeSessionId: null,
            }),
        }));
        expect(loadNewSessionDraftMock).toHaveBeenCalled();
    });

    it('re-hydrates newer draft text on focus without restoring its resume selection', async () => {
        persistedDraft.input = 'Old persisted prompt';
        persistedDraft.resumeSessionId = 'sess_old';
        persistedDraft.updatedAt = 123;

        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.promptStore.getPrompt()).toBe('Old persisted prompt');
        expect(model?.simpleProps?.resumeSessionId).toBe('');
        expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
            authoringDraft: expect.objectContaining({
                prompt: 'Old persisted prompt',
                displayText: 'Old persisted prompt',
                resumeSessionId: null,
            }),
        }));

        persistedDraft.input = 'Focused draft prompt';
        persistedDraft.resumeSessionId = 'sess_new';
        persistedDraft.selectedWorkspaceId = 'ws_payments';
        persistedDraft.selectedWorkspaceLocationId = 'loc_local';
        persistedDraft.selectedWorkspaceCheckoutId = 'checkout_feature_auth';
        persistedDraft.updatedAt = 456;
        await replaceRepositoryDraftFromPersistedFixture();

        const cleanups = await runFocusEffectsAndSettle();
        for (const cleanup of cleanups) {
            if (typeof cleanup === 'function') cleanup();
        }

        expect(model?.simpleProps?.promptStore.getPrompt()).toBe('Focused draft prompt');
        expect(model?.simpleProps?.resumeSessionId).toBe('');
        expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
            authoringDraft: expect.objectContaining({
                prompt: 'Focused draft prompt',
                displayText: 'Focused draft prompt',
                resumeSessionId: null,
            }),
        }));

        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock).toHaveBeenCalledWith(expect.objectContaining({
            input: 'Focused draft prompt',
            resumeSessionId: null,
        }));
    });

    it('does not invalidate the screen model when focus reloads an equivalent draft', async () => {
        let model: any = null;
        let renderCount = 0;

        await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
            renderCount += 1;
        });

        const renderedCount = renderCount;

        const cleanups = await runFocusEffectsAndSettle();
        for (const cleanup of cleanups) {
            if (typeof cleanup === 'function') cleanup();
        }

        expect(loadNewSessionDraftMock).toHaveBeenCalled();
        expect(renderCount).toBeLessThanOrEqual(renderedCount + 1);
    });

    it('disables hidden MCP selections while preserving the composer draft', async () => {
        featureFlags.mcpServersEnabled = true;
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.simpleProps?.agentInputExtraActionChips ?? []).toEqual([]);
        expect(useCreateNewSessionArgsRef.current?.mcpSelection).toEqual({
            v: 1, managedServersEnabled: false, forceIncludeServerIds: [], forceExcludeServerIds: [],
        });
        await act(async () => { persistDraftNowRef.current?.(); });
        expect(saveNewSessionDraftMock).toHaveBeenCalledWith(expect.objectContaining({
            input: 'hello', selectedPath: '/repo/custom',
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            mcpSelection: { v: 1, managedServersEnabled: false, forceIncludeServerIds: [], forceExcludeServerIds: [] },
        }));
    });

    it('persists canonical inferred workspace selection in autosaved drafts', async () => {
        const { useNewSessionScreenModel } = await useNewSessionScreenModelModulePromise;

        const Probe = () => { useNewSessionScreenModel(); return null; };

        await renderScreen(React.createElement(Probe));

        await act(async () => {
            persistDraftNowRef.current?.();
        });

        expect(saveNewSessionDraftMock.mock.calls.at(-1)?.[0]).toEqual(expect.not.objectContaining({
            selectedWorkspaceId: expect.anything(),
            selectedWorkspaceLocationId: expect.anything(),
            selectedWorkspaceCheckoutId: expect.anything(),
        }));
        const latestDraft = saveNewSessionDraftMock.mock.calls.at(-1)?.[0];
        expect(latestDraft).toBeTruthy();
        expect('sessionType' in (latestDraft as Record<string, unknown>)).toBe(false);
    });

    it('keeps a canonical core draft when old settings enable profile editing', async () => {
        settingsState.useProfiles = true;
        settingsState.useEnhancedSessionWizard = true;
        persistedDraft.backendTarget = { kind: 'builtInAgent', agentId: 'claude' };
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.variant).toBe('simple');
        expect(model?.wizardProps).toBeUndefined();
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({ profileId: null }));
        await act(async () => { persistDraftNowRef.current?.(); });
        expect(routerPushMock).not.toHaveBeenCalled();
        expect(saveNewSessionDraftMock).toHaveBeenCalledWith(expect.objectContaining({
            backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
            selectedMachineId: 'machine-2', selectedPath: '/repo/custom',
        }));
    });

    it('keeps the current route stable without enabling resume in the simple panel', async () => {
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.simpleProps?.showResumePicker).toBe(false);
        expect(useCreateNewSessionArgsRef.current?.resumeSessionId).toBe('');
        expect(routerPushMock).not.toHaveBeenCalled();
    });

    it('does not open a resume modal from an old iOS resume route', async () => {
        platformOsState.value = 'ios';
        searchParamsState.value = { resumeSessionId: 'legacy-resume' };
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.simpleProps?.showResumePicker).toBe(false);
        expect(useCreateNewSessionArgsRef.current?.resumeSessionId).toBe('');
        expect(modalShowMock).not.toHaveBeenCalled();
        expect(routerPushMock).not.toHaveBeenCalled();
    });

    it('keeps profiles disabled on the current route despite the saved account preference', async () => {
        settingsState.useProfiles = true;
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(model?.simpleProps?.selectedProfileId).toBeNull();
        expect(routerPushMock).not.toHaveBeenCalled();
    });

    it('drops later draft persistence after the successful launch boundary disables it', async () => {
        await renderNewSessionScreenModel(() => {});
        const persistDraft = persistDraftNowRef.current;
        await act(async () => {
            (useCreateNewSessionArgsRef.current?.disableDraftPersistence as (() => void) | undefined)?.();
            clearNewSessionDraftMock();
            await flushHookEffects({ cycles: 1, turns: 1 });
            persistDraft?.();
            await flushInteractionQueue();
        });
        expect(clearNewSessionDraftMock).toHaveBeenCalledTimes(1);
        expect(saveNewSessionDraftMock).not.toHaveBeenCalled();
    });

    it('keeps the default environment when a workspace has a legacy profile', async () => {
        settingsState.useProfiles = true;
        settingsState.useEnhancedSessionWizard = true;
        settingsState.profiles = [makeTestProfile({ id: 'profile_workspace', title: 'Workspace profile', compatibility: { claude: true } })];
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.selectedProfileId).toBeNull();
        expect(useCreateNewSessionArgsRef.current?.selectedProfileId).toBeNull();
    });

    it('does not inherit a profile when the selected workspace path changes', async () => {
        settingsState.useProfiles = true;
        settingsState.useEnhancedSessionWizard = true;
        settingsState.profiles = [
            makeTestProfile({ id: 'profile_workspace', title: 'Workspace profile', compatibility: { claude: true } }),
            makeTestProfile({ id: 'profile_docs', title: 'Docs profile', compatibility: { claude: true } }),
        ];
        workspaceGraphState.workspacesByServerId['server-a'] = [
            makeTestWorkspace({
                id: 'ws_payments',
                displayName: 'Payments',
                locationIds: ['loc_local'],
                checkoutIds: ['checkout_feature_auth'],
                defaultLocationId: 'loc_local',
                defaultCheckoutId: 'checkout_feature_auth',
            }),
            makeTestWorkspace({
                id: 'ws_docs',
                displayName: 'Docs',
                locationIds: ['loc_docs'],
                checkoutIds: ['checkout_docs_main'],
                defaultLocationId: 'loc_docs',
                defaultCheckoutId: 'checkout_docs_main',
            }),
        ];
        workspaceGraphState.workspaceLocations.loc_docs = makeTestWorkspaceLocation({
            id: 'loc_docs',
            workspaceId: 'ws_docs',
            machineId: 'machine-2',
            path: '/repo/docs',
        });
        workspaceGraphState.workspaceCheckouts.checkout_docs_main = makeTestWorkspaceCheckout({
            id: 'checkout_docs_main',
            workspaceId: 'ws_docs',
            workspaceLocationId: 'loc_docs',
            path: '/repo/docs',
            displayName: 'docs-main',
        });

        let model: any = null;
        const hook = await renderNewSessionScreenModel((nextModel) => {
            model = nextModel;
        });

        expect(model?.simpleProps?.selectedProfileId).toBeNull();

        expect(model?.simpleProps?.selectedProfileId).toBeNull();

        searchParamsState.value = {
            machineId: 'machine-2',
            path: '/repo/docs',
        };

        await hook.rerender();

        expect(model?.simpleProps?.selectedProfileId).toBeNull();
        expect(model?.simpleProps?.selectedPath).toBe('/repo/docs');
    });

    it('does not re-enable profile selection when backend authentication is logged out', async () => {
        settingsState.useProfiles = true;
        settingsState.useEnhancedSessionWizard = true;
        settingsState.lastUsedAgent = 'codex';
        settingsState.profiles = [
            makeTestProfile({ id: 'profile-1', title: 'Profile One', compatibility: { codex: true, claude: false } }),
        ];
        cliDetectionState.value = {
            timestamp: 1,
            available: { claude: true, codex: true },
            authStatus: {
                codex: { state: 'logged_out', checkedAt: 1 },
            },
        } as any;

        const { useNewSessionScreenModel } = await useNewSessionScreenModelModulePromise;

        let model: any = null;
        const Probe = () => { model = useNewSessionScreenModel(); return null; };

        await renderScreen(React.createElement(Probe));

        expect(model?.variant).toBe('simple');
        expect(model?.simpleProps?.useProfiles).toBe(false);
        expect(useCreateNewSessionArgsRef.current?.selectedProfileId).toBeNull();
    });

    it('rejects a profile route param when the profile is not selectable in the current backend set', async () => {
        settingsState.useProfiles = true;
        settingsState.useEnhancedSessionWizard = true;
        settingsState.profiles = [
            makeTestProfile({ id: 'profile-1', title: 'Profile One', compatibility: { codex: false, claude: false } }),
        ];
        searchParamsState.value = {
            profileId: 'profile-1',
        };

        const { useNewSessionScreenModel } = await useNewSessionScreenModelModulePromise;

        let model: any = null;
        const Probe = () => { model = useNewSessionScreenModel(); return null; };

        await renderScreen(React.createElement(Probe));

        expect(model?.simpleProps?.selectedProfileId).toBeNull();
        expect(useCreateNewSessionArgsRef.current?.selectedProfileId).toBeNull();
    });

});
