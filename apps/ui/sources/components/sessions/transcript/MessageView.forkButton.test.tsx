import { flushHookEffects } from '@/dev/testkit/hooks/flushHookEffects';
import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen, standardCleanup } from '@/dev/testkit';
import { installMessageViewCommonModuleMocks } from './messageViewTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const routerPushSpy = vi.fn();
const routerNavigateSpy = vi.fn();
const forkSessionSpy = vi.fn();
const openSessionForkStrategyFlowSpy = vi.fn();
const ensureSessionVisibleSpy = vi.fn();
const updateSessionDraftSpy = vi.fn();
const patchSessionMetadataWithRetrySpy = vi.fn();
const modalAlertSpy = vi.fn();
const resolveServerIdForSessionIdFromLocalCacheSpy = vi.fn<(sessionId: string) => string>();

let replayEnabled = true;
let copyButtonsVisible = true;
let sessionMetadata: any = { machineId: 'm1' };
let projectForSession: any = null;
let machinesState: Record<string, any> = {};

function flattenStyleProp(style: any): any {
  if (!style) return style;
  if (Array.isArray(style)) {
    return Object.assign({}, ...style.filter(Boolean).map(flattenStyleProp));
  }
  if (typeof style === 'object') return style;
  return {};
}

function getActionContainer(screen: any, messageId: string) {
  const forkButton = screen.findByTestId(`transcript-message-copy:${messageId}`);
  expect(forkButton).toBeTruthy();
  const actionContainer = findAncestor(forkButton, (node: any) => {
    const style = flattenStyleProp(node.props?.style);
    return (
      style?.position === 'absolute' &&
      style?.flexDirection === 'row' &&
      style?.justifyContent === 'flex-end'
    );
  });
  expect(actionContainer).toBeTruthy();
  return actionContainer!;
}

function assertForkButtonPrecedesCopyButton(screen: any, messageId: string) {
  const forkButton = screen.findByTestId(`transcript-message-fork:${messageId}`);
  const copyButton = screen.findByTestId(`transcript-message-copy:${messageId}`);
  const actionContainer = getActionContainer(screen, messageId);

  expect(forkButton).toBeTruthy();
  expect(copyButton).toBeTruthy();
  expect(forkButton?.props.accessibilityLabel).toBe('session.forking.forkFromMessageA11y');
  expect(copyButton?.props.accessibilityLabel).toBe('common.copy');

  const actionNodes = actionContainer.findAll(
    (node: any) => typeof node.props?.testID === 'string' && node.props.testID.startsWith('transcript-message-'),
  );
  const actionTestIds = actionNodes.map((node: any) => node.props.testID);
  const forkIndex = actionTestIds.indexOf(`transcript-message-fork:${messageId}`);
  const copyIndex = actionTestIds.indexOf(`transcript-message-copy:${messageId}`);
  expect(forkIndex).toBeGreaterThanOrEqual(0);
  expect(copyIndex).toBeGreaterThanOrEqual(0);
  expect(forkIndex).toBeLessThan(copyIndex);
}

function findAncestor(instance: any, predicate: (node: any) => boolean) {
  let current = instance?.parent ?? null;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent ?? null;
  }
  return null;
}

installMessageViewCommonModuleMocks({
  reactNative: async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({
      Dimensions: { get: () => ({ width: 1200, height: 800, scale: 1, fontScale: 1 }) },
      useWindowDimensions: () => ({ width: 1200, height: 800, scale: 1, fontScale: 1 }),
      Platform: {
        OS: 'web',
        select: <T,>(options: { web?: T; default?: T; native?: T; ios?: T; android?: T }) =>
          options?.web ?? options?.default ?? options?.native ?? options?.ios ?? options?.android,
      },
      View: ({ children, style, ...props }: any) =>
        React.createElement('View', { ...props, style: flattenStyleProp(style) }, children),
      Text: 'Text',
      ActivityIndicator: 'ActivityIndicator',
      Pressable: 'Pressable',
    });
  },
  unistyles: async () => {
    const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
    return createUnistylesMock();
  },
  text: async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({
      translate: (key: string) => key,
    });
  },
  modal: async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    const modalMock = createModalModuleMock();
    modalMock.spies.alert.mockImplementation((...args: any[]) => modalAlertSpy(...args));
    return modalMock.module;
  },
  router: async () => {
    const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
    const routerMock = createExpoRouterMock();
    routerMock.spies.push.mockImplementation((value: unknown) => routerPushSpy(value));
    routerMock.spies.navigate.mockImplementation((value: unknown, options?: unknown) => routerNavigateSpy(value, options));
    return routerMock.module;
  },
  storage: async (importOriginal) => {
    const { createStorageModuleStub, createStorageStoreMock } = await import('@/dev/testkit/mocks/storage');
    const storageStore = createStorageStoreMock({
      sessions: {
        s1: {
          id: 's1',
          metadata: sessionMetadata,
          updatedAt: 0,
          active: true,
        },
      },
      machines: machinesState,
      getProjectForSession: (sessionId: string) => (sessionId === 's1' ? projectForSession : null),
      updateSessionDraft: (...args: any[]) => updateSessionDraftSpy(...args),
    } as any);
    return createStorageModuleStub({
      useSetting: (key: string) => {
        if (key === 'sessionReplayEnabled') return replayEnabled;
        if (key === 'sessionThinkingDisplayMode') return 'inline';
        if (key === 'toolViewTimelineChromeMode') return 'cards';
        return null;
      },
      useSession: () => ({
        id: 's1',
        seq: 1,
        createdAt: 0,
        updatedAt: 0,
        active: true,
        activeAt: 0,
        metadata: sessionMetadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
      }),
      useSessionInteractionSource: () => ({
        accessLevel: undefined,
        canApprovePermissions: undefined,
        active: true,
      }),
      useSessionForkSupportSource: () => ({ metadata: sessionMetadata }),
      useSessionWorkspacePath: () => projectForSession?.key?.path ?? sessionMetadata?.path ?? null,
      useSessionMessagesById: () => ({}),
      useSessionMessagesReducerState: () => ({} as any),
      storage: storageStore,
    });
  },
});

vi.mock('@/components/markdown/MarkdownView', () => ({
  MarkdownView: (props: any) => React.createElement('MarkdownView', props),
}));

vi.mock('@/components/sessions/transcript/messageCopyVisibility', () => ({
  shouldShowTranscriptRowActions: () => copyButtonsVisible,
  shouldShowTranscriptRowPinAction: () => copyButtonsVisible,
}));

vi.mock('@/sync/ops', () => ({
  forkSession: (...args: any[]) => forkSessionSpy(...args),
}));

vi.mock('@/components/sessions/fork/openSessionForkStrategyFlow', () => ({
  openSessionForkStrategyFlow: (...args: any[]) => openSessionForkStrategyFlowSpy(...args),
}));

vi.mock('@/sync/sync', () => ({
  sync: {
    submitMessage: vi.fn(),
    ensureSessionVisibleForMessageRoute: (sessionId: string, options?: { forceRefresh?: boolean }) =>
      ensureSessionVisibleSpy(sessionId, options),
    patchSessionMetadataWithRetry: (...args: any[]) => patchSessionMetadataWithRetrySpy(...args),
  },
}));

vi.mock('expo-clipboard', () => ({
  setStringAsync: vi.fn(),
}));

vi.mock('@expo/vector-icons', async () => {
  const { createExpoVectorIconsMock } = await import('@/dev/testkit/mocks/icons');
  return createExpoVectorIconsMock();
});

vi.mock('@/components/sessions/transcript/structured/StructuredMessageBlock', () => ({
  StructuredMessageBlock: () => null,
  renderStructuredMessage: () => null,
}));

vi.mock('@/components/sessions/linkedFiles/extractWorkspaceFileMentions', () => ({
  extractWorkspaceFileMentions: () => [],
}));

vi.mock('@/components/sessions/transcript/references/StructuredReferencesRow', () => ({
  StructuredReferencesRow: () => null,
}));

vi.mock('@/components/tools/shell/views/ToolView', () => ({
  ToolView: () => null,
}));

vi.mock('@/components/tools/shell/views/ToolTimelineRow', () => ({
  ToolTimelineRow: () => null,
}));

vi.mock('@/components/sessions/transcript/thinking/ThinkingTimelineRow', () => ({
  ThinkingTimelineRow: ({ children }: any) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/sessions/transcript/structured/happierMetaEnvelope', () => ({
  parseHappierMetaEnvelope: () => null,
}));

vi.mock('@/sync/domains/attachments/attachmentsMessageMeta', () => ({
  AttachmentsMessageMetaV1Schema: { safeParse: () => ({ success: false }) },
}));

vi.mock('@/components/sessions/attachments/messages/AttachmentsMessageRow', () => ({
  AttachmentsMessageRow: () => null,
}));

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
  useFeatureEnabled: () => false,
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache')>()),
  resolveServerIdForSessionIdFromLocalCache: (sessionId: string) => resolveServerIdForSessionIdFromLocalCacheSpy(sessionId),
}));

describe('MessageView (fork button)', () => {
  beforeEach(() => {
    routerPushSpy.mockReset();
    routerNavigateSpy.mockReset();
    forkSessionSpy.mockReset();
    openSessionForkStrategyFlowSpy.mockReset();
    ensureSessionVisibleSpy.mockReset();
    updateSessionDraftSpy.mockReset();
    patchSessionMetadataWithRetrySpy.mockReset();
    modalAlertSpy.mockReset();
    resolveServerIdForSessionIdFromLocalCacheSpy.mockReset();
    resolveServerIdForSessionIdFromLocalCacheSpy.mockImplementation(() => 'server-a');
    ensureSessionVisibleSpy.mockResolvedValue(true);
    replayEnabled = true;
    copyButtonsVisible = true;
    sessionMetadata = { machineId: 'm1' };
    projectForSession = null;
    machinesState = {};
  });

  afterEach(() => {
    standardCleanup();
  });

  it('does not use pointerEvents prop on web when actions are hidden (prevents click interception)', async () => {
    copyButtonsVisible = false;
    const { MessageView } = await import('./MessageView');

    const message: any = { kind: 'agent-text', id: 'm1', createdAt: 1, text: 'hi', isThinking: false, seq: 5 };

    const screen = await renderScreen(<MessageView message={message} metadata={null} sessionId="s1" />);

    const actionContainer = getActionContainer(screen, 'm1');
    expect(actionContainer.props.pointerEvents).toBeUndefined();

    // The row itself never captures pointer input; the hidden slot is what blocks clicks.
    expect(flattenStyleProp(actionContainer.props.style).pointerEvents).toBe('box-none');
    expect(flattenStyleProp(screen.findByTestId('transcript-message-actions:m1')?.props.style).pointerEvents).toBe('none');
  });

  it('does not pass pointerEvents prop on web transcript row containers', async () => {
    const { MessageView } = await import('./MessageView');
    const message: any = { kind: 'agent-text', id: 'm2', createdAt: 2, text: 'hello', isThinking: false, seq: 6 };

    const screen = await renderScreen(<MessageView message={message} metadata={null} sessionId="s1" />);

    const actionContainer = getActionContainer(screen, 'm2');
    const rowContainer = findAncestor(actionContainer, (node: any) => typeof node.props?.onHoverIn === 'function');
    expect(rowContainer).toBeTruthy();
    expect(rowContainer?.props.pointerEvents).toBeUndefined();
  });

  it('keeps visible action controls interactive without forcing global overlay priority', async () => {
    copyButtonsVisible = true;
    const { MessageView } = await import('./MessageView');

    const message: any = { kind: 'agent-text', id: 'm1', createdAt: 1, text: 'hi', isThinking: false, seq: 5 };

    const screen = await renderScreen(<MessageView message={message} metadata={null} sessionId="s1" />);

    const actionContainer = getActionContainer(screen, 'm1');
    expect(actionContainer.props.pointerEvents).toBeUndefined();

    const flattened = flattenStyleProp(actionContainer.props.style);
    expect(flattened.pointerEvents).toBe('box-none');
    expect(flattened.zIndex).toBeUndefined();
    expect(flattenStyleProp(screen.findByTestId('transcript-message-actions:m1')?.props.style).pointerEvents).toBe('auto');
  });

  it.each([
    ['user-text', true], ['agent-text', true],
    ['user-text', false], ['agent-text', false],
  ] as const)('keeps copy without a fork launcher for %s with replay=%s', async (kind, replay) => {
    replayEnabled = replay;
    sessionMetadata = { machineId: 'm1', flavor: 'opencode', opencodeBackendMode: 'server' };
    const { MessageView } = await import('./MessageView');
    const message: React.ComponentProps<typeof MessageView>['message'] = kind === 'user-text'
      ? { kind, id: 'm1', localId: null, createdAt: 1, text: 'hello', seq: 5 }
      : { kind, id: 'm1', localId: null, createdAt: 1, text: 'hello', seq: 5, isThinking: false };
    const screen = await renderScreen(<MessageView message={message} metadata={null} sessionId="s1" />);
    expect(screen.findByTestId('transcript-message-fork:m1')).toBeNull();
    expect(screen.findByTestId('transcript-message-copy:m1')).not.toBeNull();
    expect(openSessionForkStrategyFlowSpy).not.toHaveBeenCalled();
  });
});
