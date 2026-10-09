import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react-test-renderer';
import { collectUnexpectedRawTextNodes, renderScreen } from '@/dev/testkit';
import { installSessionGuidanceCommonModuleMocks } from './sessionGuidanceTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const clipboardMocks = vi.hoisted(() => ({
  setStringAsync: vi.fn(async (_text: string) => {}),
}));
const openSourceGuide = vi.hoisted(() => vi.fn(async () => {}));
const tauriState = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/utils/platform/tauri', () => ({ isTauriDesktop: () => tauriState.desktop }));
const mockEnv = vi.hoisted(() => ({
  iconsRenderAsText: false,
}));
const modalMocks = vi.hoisted(() => ({
  alert: vi.fn(),
}));
const centeredInfoTileMockState = vi.hoisted(() => ({
  renderCount: 0,
}));

vi.mock('expo-clipboard', () => clipboardMocks);

vi.mock('expo-constants', () => ({
  default: { expoConfig: null, manifest: null },
}));

vi.mock('expo-updates', () => ({
  channel: null,
  releaseChannel: null,
}));

vi.mock('@expo/vector-icons', () => ({
  Ionicons: (props: any) => (
    mockEnv.iconsRenderAsText ? <>{'.'}</> : React.createElement('Ionicons', props, null)
  ),
}));

vi.mock('expo-image', () => ({
  Image: (props: any) => React.createElement('Image', props, null),
}));

vi.mock('@/components/ui/lists/CenteredInfoTile', () => ({
  CenteredInfoTile: (props: any) => {
    centeredInfoTileMockState.renderCount += 1;
    return React.createElement('CenteredInfoTile', props, props.icon ?? null);
  },
}));

vi.mock('@/constants/Typography', () => ({
  Typography: {
    default: () => ({}),
    mono: () => ({}),
  },
}));

installSessionGuidanceCommonModuleMocks({
  reactNative: async () => {
    const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
    return createReactNativeWebMock({ Linking: { openURL: openSourceGuide } });
  },
  modal: async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
      spies: modalMocks,
    }).module;
  },
});

vi.mock('@/hooks/session/useConnectTerminal', () => ({
  useConnectTerminal: () => ({
    connectTerminal: () => {},
    connectWithUrl: () => {},
    isLoading: false,
  }),
}));

vi.mock('@/components/ui/buttons/RoundButton', () => ({
  RoundButton: (props: any) => React.createElement('RoundButton', props, null),
}));

vi.mock('@/config', () => ({
  config: { variant: 'production', cliNpmDistTag: undefined },
}));

describe('SessionGettingStartedGuidanceView', () => {
  beforeEach(() => { tauriState.desktop = false; vi.unstubAllGlobals(); });

  // Web browser users see the new WebBrowserGuidance component with two-path flow:
  // Flow A (host): Setup guide button → no CLI command front and center
  // Flow B (recipient): Open shared link → no installation needed
  it.each(['connect_machine', 'start_daemon'] as const)('shows %s web guidance with two-path flow (host and recipient)', async (kind) => {
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    openSourceGuide.mockClear();
    const screen = await renderScreen(
      <SessionGettingStartedGuidanceView
        variant="primaryPane"
        model={{ kind, targetLabel: 'Company', serverUrl: 'https://api.company.example', serverName: 'company', showServerSetup: true }}
      />,
    );
    // Should show the web browser guidance container
    expect(screen.findByTestId('web-browser-guidance')).not.toBeNull();
    // Should show both paths: host and recipient
    expect(screen.findByTestId('web-guidance-host-path')).not.toBeNull();
    expect(screen.findByTestId('web-guidance-recipient-path')).not.toBeNull();
    // Host path should have setup guide button (not CLI command)
    expect(screen.findByTestId('web-guidance-setup-guide')).not.toBeNull();
    // Should NOT show CLI commands front and center (no curl command visible)
    const content = screen.getTextContent();
    expect(content).not.toContain('curl');
    expect(content).not.toContain('happier.dev/install');
    // Should NOT show old-style CLI follow-up
    expect(screen.findByTestId('session-getting-started-cli-follow-up')).toBeNull();
    // Should NOT show git clone or developer setup by default
    expect(content).not.toContain('git clone');
    expect(content).not.toContain('yarn install');
    expect(content).not.toContain('HAPPIER_SERVER_URL');
    // Should still show the scroll container and kind marker
    expect(screen.findByTestId('session-getting-started-scroll')).not.toBeNull();
    expect(screen.findByTestId(`session-getting-started-kind-${kind}`)).not.toBeNull();
  });

  it.each(['connect_machine', 'start_daemon'] as const)('web browser %s guidance has collapsible advanced section with source setup', async (kind) => {
    const origin = 'https://combo-workspace-test.43-160-242-46.sslip.io';
    const serverUrl = 'https://relay.example.test';
    vi.stubGlobal('window', { location: { origin } });
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    const screen = await renderScreen(
      <SessionGettingStartedGuidanceView variant="primaryPane" model={{ kind, targetLabel: 'COMBO', serverUrl, serverName: 'test', showServerSetup: true }} />,
    );
    // Should have advanced toggle
    expect(screen.findByTestId('web-guidance-advanced-toggle')).not.toBeNull();
    // Advanced content should be hidden by default
    expect(screen.findByTestId('web-guidance-advanced-content')).toBeNull();
    // Click to expand advanced section
    await screen.pressByTestIdAsync('web-guidance-advanced-toggle');
    // Now should show advanced content with source setup
    expect(screen.findByTestId('web-guidance-advanced-content')).not.toBeNull();
    expect(screen.findByTestId('web-guidance-source-guide')).not.toBeNull();
  });

  it('takes an online host straight to session preparation without another terminal setup workflow', async () => {
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    const onStartNewSession = vi.fn();
    const screen = await renderScreen(
      <SessionGettingStartedGuidanceView
        variant="primaryPane"
        model={{
          kind: 'create_session', targetLabel: 'COMBO', serverUrl: 'https://relay.example.test',
          serverName: 'test', showServerSetup: true, onStartNewSession,
        }}
      />,
    );

    expect(screen.findByTestId('session-getting-started-cli-follow-up')).toBeNull();
    expect(screen.findByTestId('session-getting-started-source-guide')).toBeNull();
    expect(screen.getTextContent()).not.toContain('HAPPIER_SERVER_URL');
    await screen.pressByTestIdAsync('session-getting-started-start-new-session');
    expect(onStartNewSession).toHaveBeenCalledTimes(1);
  });

  it('web browser guidance hides server URL in collapsed advanced section', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://workspace.example.test' } });
    const serverUrl = "https://relay.example.test/path?q=test";
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    const screen = await renderScreen(
      <SessionGettingStartedGuidanceView variant="primaryPane" model={{ kind: 'start_daemon', targetLabel: 'COMBO', serverUrl, serverName: 'test', showServerSetup: true }} />,
    );
    // Web browser users see the two-path guidance
    expect(screen.findByTestId('web-browser-guidance')).not.toBeNull();
    // Host path has setup guide button instead of CLI command
    expect(screen.findByTestId('web-guidance-setup-guide')).not.toBeNull();
    // Old-style CLI follow-up should not appear
    expect(screen.findByTestId('session-getting-started-cli-follow-up')).toBeNull();
    // Advanced content is hidden by default
    expect(screen.findByTestId('web-guidance-advanced-content')).toBeNull();
    // Server URL is only shown in advanced section
    const content = screen.getTextContent();
    expect(content).not.toContain(serverUrl);
    // Expand advanced and verify server URL appears
    await screen.pressByTestIdAsync('web-guidance-advanced-toggle');
    expect(screen.findByTestId('web-guidance-advanced-content')).not.toBeNull();
    const expandedContent = screen.getTextContent();
    expect(expandedContent).toContain(serverUrl);
  });

  it('uses one target-bound guided setup instead of a parallel server/auth/service recipe', async () => {
    tauriState.desktop = true;
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    const onOpenSetup = vi.fn();
    const screen = await renderScreen(
      <SessionGettingStartedGuidanceView
        variant="primaryPane"
        model={{
          kind: 'connect_machine',
          targetLabel: 'Company',
          serverUrl: 'https://api.company.example',
          serverName: 'company',
          showServerSetup: true,
          onOpenSetup,
        }}
      />,
    );

    const content = screen.getTextContent();
    expect(screen.findByTestId('session-getting-started-setup-primary-card')).not.toBeNull();
    expect(screen.findByTestId('session-getting-started-cli-follow-up')).toBeNull();
    expect(screen.findByTestId('session-getting-started-show-manual')).not.toBeNull();
    expect(content).not.toContain('happier server add');
    expect(content).not.toContain('happier daemon install');

    expect(screen.findByTestId('session-getting-started-copy-all')).toBeNull();
    expect(screen.findByTestId('session-getting-started-scroll')).not.toBeNull();
    expect(screen.findByTestId('session-getting-started-logo')).not.toBeNull();
    expect(screen.findByTestId('session-getting-started-kind-connect_machine')).not.toBeNull();
    expect(screen.findByTestId('session-getting-started-open-setup')).not.toBeNull();

    await screen.pressByTestIdAsync('session-getting-started-open-setup');
    expect(onOpenSetup).toHaveBeenCalledTimes(1);

    await screen.pressByTestIdAsync('session-getting-started-show-manual');

    const expandedContent = screen.getTextContent();
    expect(screen.findByTestId('session-getting-started-cli-follow-up')).not.toBeNull();
    expect(screen.findByTestId('session-getting-started-step-server_setup')).toBeNull();
    expect(screen.findByTestId('session-getting-started-step-auth_login')).not.toBeNull();
    expect(screen.findByTestId('session-getting-started-step-daemon_install')).toBeNull();
    expect(screen.findByTestId('session-getting-started-step-create_session')).not.toBeNull();
    expect(expandedContent).not.toContain('happier server add');
    expect(expandedContent).toContain('https://api.company.example');
    expect(expandedContent).not.toContain('$ npm i -g @happier-dev/cli');
    expect(expandedContent).toContain('curl -fsSL https://happier.dev/install | bash -s -- --yes');
    expect(expandedContent).not.toContain('npm i -g @happier-dev/cli');
    expect(expandedContent).not.toContain('happier service install');
    expect(expandedContent).toContain('happier setup --relay "https://api.company.example"');
    expect(expandedContent).not.toContain('happier daemon install');
    expect(expandedContent).toContain('happier codex');
    expect(expandedContent).toContain('happier opencode');

    clipboardMocks.setStringAsync.mockClear();
    modalMocks.alert.mockClear();
    await screen.pressByTestIdAsync('session-getting-started-copy-auth_login');
    expect(clipboardMocks.setStringAsync).toHaveBeenCalledWith('happier setup --relay "https://api.company.example"');
    expect(modalMocks.alert).not.toHaveBeenCalledWith('common.copied', 'items.copiedToClipboard');
    expect(screen.findByTestId('session-getting-started-copy-auth_login-copied')).not.toBeNull();
  });

  it('does not emit raw text nodes under View when copy icons render as text on web', async () => {
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    mockEnv.iconsRenderAsText = true;
    let screen: Awaited<ReturnType<typeof renderScreen>> | undefined;
    try {
      screen = await renderScreen(
        <SessionGettingStartedGuidanceView
          variant="primaryPane"
          model={{
            kind: 'connect_machine',
            targetLabel: 'Company',
            serverUrl: 'https://api.company.example',
            serverName: 'company',
            showServerSetup: true,
          }}
        />,
      );

      expect(collectUnexpectedRawTextNodes(screen.tree.toJSON())).toEqual([]);
    } finally {
      mockEnv.iconsRenderAsText = false;
      act(() => {
        screen?.tree.unmount();
      });
    }
  });

  it('shows the phone web browser guidance with two-path flow', async () => {
    vi.useFakeTimers();
    try {
      const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
      const onConnectTerminal = vi.fn();
      const onEnterUrlManually = vi.fn();

      const screen = await renderScreen(
        <SessionGettingStartedGuidanceView
          variant="phone"
          model={{
            kind: 'connect_machine',
            targetLabel: 'Company',
            serverUrl: 'https://api.company.example',
            serverName: 'company',
            showServerSetup: true,
            onConnectTerminal,
            onEnterUrlManually,
          }}
        />,
      );

      expect(screen.findByTestId('session-getting-started-kind-connect_machine')).not.toBeNull();
      // Web browser users see the new two-path guidance
      expect(screen.findByTestId('web-browser-guidance')).not.toBeNull();
      expect(screen.findByTestId('web-guidance-host-path')).not.toBeNull();
      expect(screen.findByTestId('web-guidance-recipient-path')).not.toBeNull();
      // Old CLI follow-up should not appear
      expect(screen.findByTestId('session-getting-started-cli-follow-up')).toBeNull();

      act(() => {
        vi.runOnlyPendingTimers();
      });

      // After timers settle, the two-path guidance remains
      expect(screen.findByTestId('web-browser-guidance')).not.toBeNull();
      expect(screen.findByTestId('session-getting-started-cli-follow-up')).toBeNull();
      expect(screen.findByTestId('session-getting-started-step-install_cli')).toBeNull();
      expect(screen.findByTestId('session-getting-started-step-auth_login')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows new-session blocking header without CLI follow-up for web browser users', async () => {
    vi.useFakeTimers();
    try {
      const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');

      const screen = await renderScreen(
        <SessionGettingStartedGuidanceView
          variant="newSessionBlocking"
          model={{
            kind: 'connect_machine',
            targetLabel: 'Company',
            serverUrl: 'https://api.company.example',
            serverName: 'company',
            showServerSetup: true,
          }}
        />,
      );

      expect(screen.findByTestId('session-getting-started-logo')).not.toBeNull();
      expect(screen.findByTestId('session-getting-started-kind-connect_machine')).not.toBeNull();
      // Web browser users don't see CLI follow-up steps
      expect(screen.findByTestId('session-getting-started-cli-follow-up')).toBeNull();

      act(() => {
        vi.runOnlyPendingTimers();
      });

      // After timers settle, web browser users still don't see CLI follow-up
      expect(screen.findByTestId('session-getting-started-cli-follow-up')).toBeNull();
      expect(screen.findByTestId('session-getting-started-step-server_setup')).toBeNull();
      expect(screen.findByTestId('session-getting-started-step-auth_login')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers the desktop setup CTA when machines exist but the daemon still needs attention', async () => {
    tauriState.desktop = true;
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    const onOpenSetup = vi.fn();
    const screen = await renderScreen(
      <SessionGettingStartedGuidanceView
        variant="primaryPane"
        model={{
          kind: 'start_daemon',
          targetLabel: 'Company',
          serverUrl: 'https://api.company.example',
          serverName: 'company',
          showServerSetup: true,
          onOpenSetup,
        }}
      />,
    );

    expect(screen.findByTestId('session-getting-started-setup-primary-card')).not.toBeNull();
    expect(screen.findByTestId('session-getting-started-open-setup')).not.toBeNull();
    await screen.pressByTestIdAsync('session-getting-started-open-setup');
    expect(onOpenSetup).toHaveBeenCalledTimes(1);
  });

  it('shows canonical background-service commands in the manual daemon setup flow', async () => {
    tauriState.desktop = true;
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    const screen = await renderScreen(
      <SessionGettingStartedGuidanceView
        variant="primaryPane"
        model={{
          kind: 'start_daemon',
          targetLabel: 'Company',
          serverUrl: 'https://api.company.example',
          serverName: 'company',
          showServerSetup: false,
        }}
      />,
    );

    const content = screen.getTextContent();
    expect(content).toContain('happier service install');
    expect(content).toContain('happier service start');
    expect(content).not.toContain('happier daemon install');
    expect(content).not.toContain('happier daemon start');
  });

  it('skips rerendering the guidance view when props are equal by value', async () => {
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    centeredInfoTileMockState.renderCount = 0;
    const createElement = () => (
      <SessionGettingStartedGuidanceView
        variant="primaryPane"
        model={{
          kind: 'select_session',
          targetLabel: 'Company',
          serverUrl: 'https://api.company.example',
          serverName: 'company',
          showServerSetup: false,
        }}
      />
    );

    const screen = await renderScreen(createElement());
    expect(centeredInfoTileMockState.renderCount).toBe(1);

    act(() => {
      screen.tree.update(createElement());
    });

    expect(centeredInfoTileMockState.renderCount).toBe(1);
  });

  it('renders select-session as a centered icon empty state in the primary pane', async () => {
    const { SessionGettingStartedGuidanceView } = await import('./SessionGettingStartedGuidance');
    const screen = await renderScreen(
      <SessionGettingStartedGuidanceView
        variant="primaryPane"
        model={{
          kind: 'select_session',
          targetLabel: 'Company',
          serverUrl: 'https://api.company.example',
          serverName: 'company',
          showServerSetup: false,
        }}
      />,
    );

    expect(screen.findByTestId('session-empty-state-card')).toBeNull();
    expect(screen.findByTestId('session-empty-state-summary')).not.toBeNull();
    expect(screen.findByTestId('session-empty-state-icon')).not.toBeNull();
    expect(screen.findByTestId('session-getting-started-logo')).toBeNull();
    const scrollView = screen.findByTestId('session-getting-started-scroll');
    expect(scrollView).not.toBeNull();
    const contentContainerStyle = scrollView!.props.contentContainerStyle;
    const flattenedContentContainerStyle = Array.isArray(contentContainerStyle)
      ? Object.assign({}, ...contentContainerStyle.filter(Boolean))
      : contentContainerStyle;
    expect(flattenedContentContainerStyle.justifyContent).toBe('center');
  });
});
