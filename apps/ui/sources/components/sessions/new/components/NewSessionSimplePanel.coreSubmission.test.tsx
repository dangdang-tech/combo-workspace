import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installNewSessionComponentsCommonModuleMocks } from './newSessionComponentsTestHelpers';
import { createNewSessionPromptStore } from '@/components/sessions/new/hooks/screenModel/newSessionPromptStore';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const AgentInputMock = vi.fn((_props: any) => null);
const mockEnv = vi.hoisted(() => ({
    iconsRenderAsText: false,
}));
const attachmentDraftState = vi.hoisted(() => ({
    drafts: [] as Array<{ id: string }>,
    hasSendableAttachments: false,
    agentInputAttachments: [] as Array<unknown>,
    clearDrafts: vi.fn(),
    applyDraftPatch: vi.fn(),
}));
const uploadAttachmentDraftsToSessionSpy = vi.hoisted(() => vi.fn());
const formatAttachmentsBlockSpy = vi.hoisted(() => vi.fn(() => ''));
const followUpSpawnedSessionWithServerScopeSpy = vi.hoisted(() => vi.fn());
const workspaceReviewDraftsState = vi.hoisted(() => ({
    draftsByRootPath: new Map<string, Array<{
        id: string;
        filePath: string;
        source: 'file' | 'diff';
        anchor: Record<string, unknown>;
        snapshot: {
            selectedLines: string[];
            beforeContext: string[];
            afterContext: string[];
        };
        body: string;
        includeInPrompt?: boolean;
        createdAt: number;
    }>>(),
}));

installNewSessionComponentsCommonModuleMocks({
    icons: () => ({
        Ionicons: (props: Record<string, unknown>) => (
            mockEnv.iconsRenderAsText ? <>{'.'}</> : React.createElement('Ionicons', props, null)
        ),
    }),
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('View', props, props.children),
            Pressable: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('Pressable', props, props.children),
            Text: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('Text', props, props.children),
            Platform: {
                OS: 'web',
                select: (v: any) => v.web ?? v.default ?? null,
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useWorkspaceReviewCommentsDrafts: (scope: { rootPath?: string } | null | undefined) => (
                scope?.rootPath ? (workspaceReviewDraftsState.draftsByRootPath.get(scope.rootPath) ?? []) : []
            ),
        });
    },
});

vi.mock('react-native-safe-area-context', () => ({
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children,
    SafeAreaView: 'SafeAreaView',
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/popover', () => ({
    PopoverBoundaryProvider: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement(React.Fragment, null, props.children),
    PopoverPortalTargetProvider: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement(React.Fragment, null, props.children),
    PopoverScope: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement(React.Fragment, null, props.children),
}));

vi.mock('@/components/sessions/agentInput', () => ({
    AgentInput: AgentInputMock,
}));

vi.mock('@/components/sessions/attachments/AttachmentFilePicker', () => ({
    AttachmentFilePicker: () => null,
}));

const addWebFilesSpy = vi.fn();
const addPickedAttachmentsSpy = vi.fn();

vi.mock('@/components/sessions/attachments/useAttachmentsUploadConfig', () => ({
    useAttachmentsUploadConfig: () => ({
        uploadLocation: 'workspace',
        workspaceRelativeDir: '.happier/uploads',
        vcsIgnoreStrategy: 'git_info_exclude',
        vcsIgnoreWritesEnabled: true,
        maxFileBytes: 25 * 1024 * 1024,
    }),
}));

vi.mock('@/components/sessions/attachments/useAttachmentDraftManager', () => ({
    useAttachmentDraftManager: () => ({
        filePickerRef: { current: null },
        drafts: attachmentDraftState.drafts,
        hasSendableAttachments: attachmentDraftState.hasSendableAttachments,
        agentInputAttachments: attachmentDraftState.agentInputAttachments,
        addWebFiles: addWebFilesSpy,
        addPickedAttachments: addPickedAttachmentsSpy,
        removeDraft: vi.fn(),
        clearDrafts: attachmentDraftState.clearDrafts,
        applyDraftPatch: attachmentDraftState.applyDraftPatch,
    }),
}));

vi.mock('@/components/sessions/attachments/uploadAttachmentDraftsToSession', () => ({
    uploadAttachmentDraftsToSession: uploadAttachmentDraftsToSessionSpy,
    formatAttachmentsBlock: formatAttachmentsBlockSpy,
}));

vi.mock('@/sync/sync', () => ({
    sync: { sendMessage: vi.fn() },
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/followUpSpawnedSession', () => ({
    followUpSpawnedSessionWithServerScope: followUpSpawnedSessionWithServerScopeSpy,
}));

vi.mock('@/utils/platform/deferOnWeb', () => ({
    blurActiveElementOnWeb: vi.fn(),
    deferOnWeb: (callback: () => void) => callback(),
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: (featureId: string) => featureId === 'attachments.uploads' || featureId === 'files.reviewComments',
}));

afterEach(() => {
    workspaceReviewDraftsState.draftsByRootPath.clear();
    standardCleanup();
});

describe('NewSessionSimplePanel (core submission)', () => {
    async function renderPanel(overrides: Record<string, unknown> = {}) {
        const { NewSessionSimplePanel } = await import('./NewSessionSimplePanel');
        AgentInputMock.mockClear();
        const handleCreateSession = vi.fn();
        const props: React.ComponentProps<typeof NewSessionSimplePanel> = {
                    popoverBoundaryRef: { current: null } as unknown as React.RefObject<any>,
                    headerHeight: 44,
                    safeAreaTop: 0,
                    safeAreaBottom: 0,
                    newSessionTopPadding: 0,
                    newSessionSidePadding: 0,
                    newSessionBottomPadding: 0,
                    containerStyle: {},
                    promptStore: createNewSessionPromptStore('Read this project'),
                    setSessionPrompt: () => {},
                    handleCreateSession,
                    canCreate: true,
                    isCreating: false,
                    emptyAutocompleteKinds: [],
                    emptyAutocompleteSuggestions: async () => [],
                    sessionPromptInputMaxHeight: 200,
                    agentInputExtraActionChips: [],
                    agentType: 'codex',
                    handleAgentClick: () => {},
                    permissionMode: 'default',
                    handlePermissionModeChange: () => {},
                    modelMode: 'default',
                    setModelMode: () => {},
                    modelOptions: [{ value: 'default', label: 'Default', description: '' }],
                    connectionStatus: undefined,
                    machineName: undefined,
                    selectedPath: '',
                    showResumePicker: false,
                    resumeSessionId: null,
                    isResumeSupportChecking: false,
                    useProfiles: false,
                    selectedProfileId: null,
                };
        const screen = await renderScreen(<NewSessionSimplePanel {...props} {...overrides} />);
        const input = () => AgentInputMock.mock.calls.at(-1)?.[0];
        return { screen, input, handleCreateSession, props };
    }

    it('omits attachments even when the persisted feature is enabled', async () => {
        const { input } = await renderPanel();
        expect(input()?.onAttachmentsAdded).toBeUndefined();
        expect(input()?.attachments).toBeUndefined();
        expect(input()?.extraActionChips).toBeUndefined();
    });

    it('guides sharing preparation and sends the original task without consuming stored attachments or review comments', async () => {
        attachmentDraftState.drafts = [{ id: 'old-attachment' }];
        attachmentDraftState.hasSendableAttachments = true;
        attachmentDraftState.clearDrafts.mockClear();
        uploadAttachmentDraftsToSessionSpy.mockClear();
        workspaceReviewDraftsState.draftsByRootPath.set('/repo', [{
            id: 'old-review', filePath: 'README.md', source: 'file', anchor: {},
            snapshot: { selectedLines: ['old text'], beforeContext: [], afterContext: [] },
            body: 'Old review comment', includeInPrompt: true, createdAt: 1,
        }]);
        const { screen, input, handleCreateSession } = await renderPanel({ selectedPath: '/repo', machineName: 'My computer' });
        const content = screen.getTextContent();
        expect(content).toContain('sharedEntry.guidePrepareTitle');
        expect(content).toContain('sharedEntry.guideSteps');
        expect(content).toContain('sharedEntry.guidePrepareBody');
        expect(input()?.currentPath).toBe('/repo');
        expect(input()?.machineName).toBe('My computer');
        await act(async () => { input()?.onSend(); });

        expect(handleCreateSession).toHaveBeenCalledWith({ inputTextOverride: 'Read this project' });
        expect(uploadAttachmentDraftsToSessionSpy).not.toHaveBeenCalled();
        expect(attachmentDraftState.clearDrafts).not.toHaveBeenCalled();
        expect(workspaceReviewDraftsState.draftsByRootPath.get('/repo')).toHaveLength(1);
    });

    it('preserves a composer text override and structured mention metadata', async () => {
        const { input, handleCreateSession } = await renderPanel();
        const structuredInputMetaOverrides = { mentions: [{ kind: 'session', id: 'session-1' }] };
        await act(async () => {
            input()?.onSend({ inputTextOverride: 'Read the selected file', structuredInputMetaOverrides });
        });
        expect(handleCreateSession).toHaveBeenCalledWith({
            inputTextOverride: 'Read the selected file', structuredInputMetaOverrides,
        });
    });

    it('continues a pending launch once without replacing its captured prompt', async () => {
        const { screen, handleCreateSession, props } = await renderPanel({ resumePersistedLaunchKey: 'pending-launch' });
        expect(handleCreateSession).toHaveBeenCalledTimes(1);
        expect(handleCreateSession).toHaveBeenCalledWith(undefined);
        const { NewSessionSimplePanel } = await import('./NewSessionSimplePanel');
        await screen.update(<NewSessionSimplePanel {...props} resumePersistedLaunchKey="pending-launch" />);
        expect(handleCreateSession).toHaveBeenCalledTimes(1);
    });
});
