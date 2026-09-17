import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushHookEffects, standardCleanup } from '@/dev/testkit';

import {
    modalShowMock,
    notifyMockStorageSubscribers,
    persistDraftNowRef,
    persistedDraft,
    platformOsState,
    renderNewSessionScreenModel,
    replaceRepositoryDraftFromPersistedFixture,
    repoSnapshotState,
    resetDraftPersistenceState,
    routerPushMock,
    runFocusEffectsAndSettle,
    saveNewSessionDraftMock,
    searchParamsState,
    targetServerState,
    useCreateNewSessionArgsRef,
    workspaceGraphState,
} from './__tests__/draftPersistenceTestEnvironment';
import { findCheckoutChip } from './__tests__/checkoutChipSelectors';

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

// The core composer keeps the selected directory. Old worktree drafts and route
// handoffs must not create a checkout or reopen the removed checkout picker.
describe('useNewSessionScreenModel (draft hydration — checkout)', () => {
    afterEach(() => { standardCleanup(); vi.restoreAllMocks(); });
    beforeEach(async () => { await resetDraftPersistenceState(); });

    it('keeps newer draft text and directory on focus without restoring worktree creation', async () => {
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(findCheckoutChip(model)).toBeUndefined();

        persistedDraft.input = 'Continue this draft';
        persistedDraft.checkoutCreationDraft = {
            kind: 'git_worktree', displayName: 'feature/focused-browser-fix', baseRef: 'main',
        };
        persistedDraft.updatedAt = 456;
        await replaceRepositoryDraftFromPersistedFixture();
        const cleanups = await runFocusEffectsAndSettle();
        for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();

        expect(model?.simpleProps?.promptStore.getPrompt()).toBe('Continue this draft');
        expect(model?.simpleProps?.selectedPath).toBe('/repo/custom');
        expect(model?.simpleProps?.checkoutCreationDraft).toBeNull();
        expect(findCheckoutChip(model)).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.authoringDraft).toEqual(expect.objectContaining({
            prompt: 'Continue this draft', directory: '/repo/custom', checkoutCreationDraft: null,
        }));
    });

    it('autosaves the selected machine and directory without checkout or workspace side effects', async () => {
        await renderNewSessionScreenModel(() => {});
        await act(async () => { persistDraftNowRef.current?.(); });
        const draft = saveNewSessionDraftMock.mock.calls.at(-1)?.[0];
        expect(draft).toEqual(expect.objectContaining({
            input: 'hello', selectedMachineId: 'machine-2', selectedPath: '/repo/custom',
            checkoutCreationDraft: null,
        }));
        expect(draft).toEqual(expect.not.objectContaining({
            selectedWorkspaceId: expect.anything(),
            selectedWorkspaceLocationId: expect.anything(),
            selectedWorkspaceCheckoutId: expect.anything(),
        }));
    });

    it.each(['web', 'ios'] as const)('does not open a checkout picker from an old worktree route on %s', async (platform) => {
        platformOsState.value = platform;
        workspaceGraphState.workspacesByServerId['server-a'] = [];
        workspaceGraphState.workspaceLocations = {};
        workspaceGraphState.workspaceCheckouts = {};
        repoSnapshotState.value = {
            ...repoSnapshotState.value,
            repo: {
                ...repoSnapshotState.value.repo,
                worktrees: [
                    { path: '/repo/custom', branch: 'main', isCurrent: true },
                    { path: '/repo/release', branch: 'release', isCurrent: false },
                ],
            },
        };
        searchParamsState.value = { worktree: 'new' };
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(findCheckoutChip(model)).toBeUndefined();
        expect(model?.simpleProps?.selectedPath).toBe('/repo/custom');
        expect(useCreateNewSessionArgsRef.current?.checkoutCreationDraft).toBeNull();
        expect(modalShowMock).not.toHaveBeenCalled();
        expect(routerPushMock).not.toHaveBeenCalled();
    });

    it('keeps the selected directory when the workspace graph changes', async () => {
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        await act(async () => {
            workspaceGraphState.workspaceLocations = {};
            workspaceGraphState.workspaceCheckouts = {};
            notifyMockStorageSubscribers();
            await flushHookEffects({ cycles: 1, turns: 2 });
        });
        expect(model?.simpleProps?.selectedPath).toBe('/repo/custom');
        expect(model?.simpleProps?.selectedMachineId).toBe('machine-2');
        expect(findCheckoutChip(model)).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.checkoutCreationDraft).toBeNull();
    });

    it('keeps the active server and directory without inheriting another server checkout', async () => {
        await installActiveServerTargetFixture();
        targetServerState.allowedTargetServerIds = ['server-a', 'server-b'];
        targetServerState.targetServerId = 'server-b';
        targetServerState.targetServerName = 'Server B';
        let model: any = null;
        await renderNewSessionScreenModel((nextModel) => { model = nextModel; });
        expect(model?.simpleProps?.selectedPath).toBe('/repo/custom');
        expect(model?.simpleProps?.selectedMachineId).toBe('machine-2');
        expect(findCheckoutChip(model)).toBeUndefined();
        expect(useCreateNewSessionArgsRef.current?.targetServerId).toBe('server-a');
        expect(useCreateNewSessionArgsRef.current?.checkoutCreationDraft).toBeNull();
    });
});
