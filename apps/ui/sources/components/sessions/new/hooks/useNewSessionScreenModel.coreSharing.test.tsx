import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { standardCleanup } from '@/dev/testkit';
import type { useNewSessionScreenModel } from './useNewSessionScreenModel';
import {
    featureFlags,
    makeTestAutomationDraft,
    makeTestProfile,
    persistDraftNowRef,
    persistedDraft,
    renderNewSessionScreenModel,
    replaceRepositoryDraftFromPersistedFixture,
    resetDraftPersistenceState,
    runFocusEffectsAndSettle,
    saveNewSessionDraftMock,
    searchParamsState,
    settingsState,
    tempSessionDataState,
    useCreateNewSessionArgsRef,
} from './__tests__/draftPersistenceTestEnvironment';

const codexTarget = { kind: 'builtInAgent', agentId: 'codex' } as const;
const disabledMcpSelection = {
    v: 1, managedServersEnabled: false, forceIncludeServerIds: [], forceExcludeServerIds: [],
};
const legacyTargets = [
    { label: 'Claude', agentId: 'claude', target: { kind: 'builtInAgent', agentId: 'claude' } },
    { label: 'configured ACP', agentId: 'customAcp', target: { kind: 'configuredAcpBackend', backendId: 'review-bot' } },
] as const;

async function renderModel() {
    let observed: unknown;
    await renderNewSessionScreenModel((model) => { observed = model; });
    return observed as ReturnType<typeof useNewSessionScreenModel>;
}

function expectCoreSubmission() {
    // This shared harness captures the canonical creation-hook boundary. It does
    // not spawn a session; check both scalar inputs and its nested authoring draft.
    const args = useCreateNewSessionArgsRef.current;
    expect(args).not.toBeNull();
    const expectedScalars = {
        agentType: 'codex',
        backendTarget: codexTarget,
        useProfiles: false,
        selectedProfileId: null,
        checkoutCreationDraft: null,
        automationEditId: null,
        mcpSelection: disabledMcpSelection,
        acpSessionModeId: null,
        sessionConfigOptionOverrides: null,
        agentNewSessionOptions: null,
    };
    for (const [key, value] of Object.entries(expectedScalars)) {
        expect(args?.[key], key).toEqual(value);
    }
    expect(args?.authoringDraft).toEqual(expect.objectContaining({
        agentId: 'codex',
        backendTarget: codexTarget,
        profileId: null,
        resumeSessionId: null,
        checkoutCreationDraft: null,
        automation: null,
        mcpSelection: disabledMcpSelection,
        acpSessionModeId: null,
        sessionConfigOptionOverrides: null,
    }));
    expect(args?.resumeSessionId).toBeFalsy();
}

describe('useNewSessionScreenModel (core sharing)', () => {
    beforeEach(async () => {
        await resetDraftPersistenceState();
        persistedDraft.selectedProfileId = null;
        delete persistedDraft.agentNewSessionOptionStateByAgentId;
        settingsState.lastUsedAgent = 'codex';
        Object.assign(settingsState, {
            lastUsedBackendTarget: null,
            serverSelectionGroups: [],
            serverSelectionActiveTargetKind: null,
            serverSelectionActiveTargetId: null,
            acpCatalogSettingsV1: {
                v: 2,
                backends: [{
                    id: 'review-bot', name: 'review-bot', title: 'Review Bot',
                    command: 'review-bot', args: [], env: {}, transportProfile: 'generic',
                    capabilities: {
                        supportsLoadSession: false,
                        supportsModes: 'unknown', supportsModels: 'unknown',
                        supportsConfigOptions: 'unknown', promptImageSupport: 'unknown',
                    },
                    createdAt: 1, updatedAt: 1,
                }],
            },
        });
    });

    afterEach(() => {
        standardCleanup();
        vi.restoreAllMocks();
    });

    it('keeps the simple composer when an old account setting enables the enhanced wizard', async () => {
        settingsState.useEnhancedSessionWizard = true;
        const model = await renderModel();
        expect(model.variant).toBe('simple');
    });

    for (const source of ['draft', 'temp', 'route', 'lastUsed'] as const) {
        it.each(legacyTargets)(`falls back to built-in Codex for $label selected by ${source}`, async ({ agentId, target }) => {
            // Remove the default draft backend so the tested source owns selection.
            Object.assign(persistedDraft, { agentType: undefined, backendTarget: undefined });
            if (source === 'draft') {
                Object.assign(persistedDraft, { agentType: agentId, backendTarget: target });
            } else if (source === 'temp') {
                searchParamsState.value = { dataId: 'legacy-backend' };
                tempSessionDataState.value = { agentType: agentId, backendTarget: target };
            } else if (source === 'route') {
                searchParamsState.value = { agentType: agentId, backendTarget: JSON.stringify(target) };
            } else {
                Object.assign(settingsState, { lastUsedAgent: agentId, lastUsedBackendTarget: target });
            }

            const model = await renderModel();
            expect(model.variant).toBe('simple');
            if (model.variant !== 'simple') throw new Error('Expected the core simple composer');
            expect(model.simpleProps.agentType).toBe('codex');
            expect(useCreateNewSessionArgsRef.current).toEqual(expect.objectContaining({
                agentType: 'codex', backendTarget: codexTarget,
                authoringDraft: expect.objectContaining({ agentId: 'codex', backendTarget: codexTarget }),
            }));
        });
    }

    it.each(['draft', 'temp', 'route'] as const)('preserves user content while excluding legacy %s launch selections', async (source) => {
        settingsState.useProfiles = true;
        settingsState.profiles = [makeTestProfile({ id: 'legacy-profile', title: 'Legacy profile', compatibility: { codex: true, claude: true } })];
        featureFlags.automationsEnabled = true;
        featureFlags.mcpServersEnabled = true;
        persistedDraft.input = 'Keep this unfinished prompt';
        persistedDraft.permissionMode = 'yolo';
        const automationDraft = makeTestAutomationDraft({ enabled: true, name: 'Legacy schedule' });
        if (source === 'draft') {
            Object.assign(persistedDraft, {
                selectedProfileId: 'legacy-profile', resumeSessionId: 'legacy-resume', automationDraft,
            });
        } else if (source === 'temp') {
            searchParamsState.value = { dataId: 'legacy-selection' };
            tempSessionDataState.value = {
                prompt: 'Keep this unfinished prompt', machineId: 'machine-2', directory: '/repo/custom',
                permissionMode: 'yolo', profileId: 'legacy-profile', resumeSessionId: 'legacy-resume',
                checkoutCreationDraft: persistedDraft.checkoutCreationDraft, automationDraft,
                mcpSelection: persistedDraft.mcpSelection,
                acpSessionModeId: 'plan', sessionConfigOptionOverrides: persistedDraft.sessionConfigOptionOverrides,
            };
        } else {
            searchParamsState.value = {
                profileId: 'legacy-profile', resumeSessionId: 'legacy-resume', worktree: 'new',
                automation: '1', automationEnabled: 'true', automationName: 'Legacy schedule',
                automationEditId: 'legacy-automation',
            };
        }

        const model = await renderModel();
        expect(model.variant).toBe('simple');
        if (model.variant !== 'simple') throw new Error('Expected the core simple composer');
        expect(model.simpleProps.promptStore.getPrompt()).toBe('Keep this unfinished prompt');
        expect(model.simpleProps.selectedMachineId).toBe('machine-2');
        expect(model.simpleProps.selectedPath).toBe('/repo/custom');
        expect(model.simpleProps.permissionMode).toBe('yolo');
        expectCoreSubmission();

        await act(async () => { persistDraftNowRef.current?.(); });
        expect(saveNewSessionDraftMock).toHaveBeenLastCalledWith(expect.objectContaining({
            input: 'Keep this unfinished prompt', selectedMachineId: 'machine-2',
            selectedPath: '/repo/custom', permissionMode: 'yolo',
        }));
    });

    it('does not forward hidden backend extra options from a saved draft', async () => {
        const agentCatalog = await import('@/agents/catalog/catalog');
        persistedDraft.agentType = 'codex';
        persistedDraft.backendTarget = codexTarget;
        persistedDraft.agentNewSessionOptionStateByAgentId = { codex: { legacyExtra: true }, 'agent:codex': { legacyExtra: true } };
        vi.spyOn(agentCatalog, 'buildNewSessionOptionsFromUiState').mockImplementation(({ agentOptionState }) => (
            agentOptionState?.legacyExtra ? { legacyExtra: true } : {}
        ));
        await renderModel();
        expect(useCreateNewSessionArgsRef.current?.agentNewSessionOptions).toBeNull();
    });

    it.each(['draft', 'route with a saved multi-server group'] as const)('keeps an old %s target on the active server', async (source) => {
        const sourceModule = await import('./serverTarget/useNewSessionActiveServerSource');
        const targetModule = await import('./serverTarget/useNewSessionServerTargetState');
        const realTargetModule = await vi.importActual<typeof targetModule>('./serverTarget/useNewSessionServerTargetState');
        vi.spyOn(sourceModule, 'useNewSessionActiveServerSource').mockReturnValue({
            activeServerId: 'server-a',
            serverProfilesSignature: 'core-sharing-server-fixture',
            serverProfiles: ['a', 'b', 'c'].map((id) => ({
                id: `server-${id}`, name: `Server ${id}`, serverUrl: `https://${id}.example.test`,
                createdAt: 1, updatedAt: 1, lastUsedAt: 1,
            })),
        });
        // Keep the real canonical target resolver. Only the active server source
        // is a fixture; the assertions exercise actual settings/route precedence.
        vi.spyOn(targetModule, 'useNewSessionServerTargetState').mockImplementation(realTargetModule.useNewSessionServerTargetState);
        persistedDraft.targetServerId = 'server-b';
        Object.assign(settingsState, {
            serverSelectionActiveTargetKind: source === 'draft' ? 'server' : 'group',
            serverSelectionActiveTargetId: source === 'draft' ? 'server-b' : 'legacy-group',
            serverSelectionGroups: [{ id: 'legacy-group', name: 'Legacy group', serverIds: ['server-b', 'server-c'], presentation: 'grouped' }],
        });
        if (source !== 'draft') searchParamsState.value = { spawnServerId: 'server-c' };

        const model = await renderModel();
        expect(useCreateNewSessionArgsRef.current?.targetServerId).toBe('server-a');
        expect(useCreateNewSessionArgsRef.current?.allowedTargetServerIds).toEqual(['server-a']);
        expect(model.variant).toBe('simple');
        if (model.variant !== 'simple') throw new Error('Expected the core simple composer');
        expect(model.simpleProps.selectedMachineId).toBe('machine-2');
        expect(model.simpleProps.selectedPath).toBe('/repo/custom');
        expect(model.simpleProps.promptStore.getPrompt()).toBe('hello');
    });

    it('keeps later focused draft text without reintroducing hidden launch selections', async () => {
        await renderModel();
        Object.assign(persistedDraft, {
            input: 'Newer saved text', updatedAt: 456,
            backendTarget: legacyTargets[1].target, agentType: 'customAcp',
            resumeSessionId: 'later-resume',
            automationDraft: makeTestAutomationDraft({ enabled: true, name: 'Later schedule' }),
        });
        await replaceRepositoryDraftFromPersistedFixture();
        const cleanups = await runFocusEffectsAndSettle();
        for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();

        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({
            prompt: 'Newer saved text', directory: '/repo/custom', permissionMode: 'yolo',
        }));
        expectCoreSubmission();
    });
});
