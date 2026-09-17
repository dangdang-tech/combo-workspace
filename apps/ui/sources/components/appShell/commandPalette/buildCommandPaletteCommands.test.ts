import { describe, expect, it, vi } from 'vitest';

import { buildCommandPaletteCommands } from './buildCommandPaletteCommands';

vi.mock('@/sync/domains/state/storage', async () => {
  const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
  return createStorageModuleStub({
    storage: {
      getState: () => ({ settings: { experiments: true, featureToggles: { 'execution.runs': true } } }),
    },
  });
});

function createParams() {
  return {
    sessionsById: {} as Record<string, any>,
    isDev: true,
    activeSessionId: 'session-1',
    features: {
      executionRunsEnabled: true,
      voiceEnabled: true,
      memorySearchEnabled: true,
      petsCompanionEnabled: true,
    },
    petControls: {
      surface: 'desktopOverlay' as const,
      wake: vi.fn(),
      tuck: vi.fn(),
      resetPosition: vi.fn(),
      refreshCodexPets: vi.fn(),
    },
    nav: { push: vi.fn(), openNewSession: vi.fn(), navigateToSession: vi.fn() },
    auth: { logout: vi.fn(async () => {}) },
    actions: { execute: vi.fn(async () => ({ ok: true })) },
    alert: vi.fn(),
  };
}

const coreCommandIds = ['new-session', 'sessions', 'settings', 'account', 'machines', 'connect', 'sign-out'];

describe('buildCommandPaletteCommands', () => {
  it('keeps only core navigation even when legacy feature preferences and development mode are enabled', () => {
    const commands = buildCommandPaletteCommands(createParams());

    expect(commands.map((command) => command.id)).toEqual(coreCommandIds);
  });

  it('delegates new-session to the caller-owned ordinary-entry callback', async () => {
    const params = createParams();
    const commands = buildCommandPaletteCommands(params);

    await commands.find((command) => command.id === 'new-session')!.action();

    expect(params.nav.openNewSession).toHaveBeenCalledTimes(1);
    expect(params.nav.push).not.toHaveBeenCalled();
  });

  it('opens the existing machines settings route', async () => {
    const params = createParams();
    const commands = buildCommandPaletteCommands(params);
    const machines = commands.find((command) => command.id === 'machines');

    expect(machines).toBeDefined();
    await machines!.action();

    expect(params.nav.push).toHaveBeenCalledWith('/settings/machines');
  });

  it('preserves core destinations and sign out', async () => {
    const params = createParams();
    const commands = buildCommandPaletteCommands(params);

    for (const id of ['sessions', 'settings', 'account', 'connect', 'sign-out']) {
      await commands.find((command) => command.id === id)!.action();
    }

    expect(params.nav.push.mock.calls).toEqual([
      ['/'], ['/settings'], ['/settings/account'], ['/scan/terminal'],
    ]);
    expect(params.auth.logout).toHaveBeenCalledTimes(1);
  });

  it('keeps the five most recently updated sessions and uses canonical session navigation', async () => {
    const params = createParams();
    params.sessionsById = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [
      `session-${index}`,
      { id: `session-${index}`, updatedAt: index, metadata: { name: ` Shared ${index} `, path: ` /project/${index} ` } },
    ]));
    const commands = buildCommandPaletteCommands(params);
    const recent = commands.filter((command) => command.id.startsWith('session-'));

    expect(recent.map((command) => command.id)).toEqual([
      'session-session-6', 'session-session-5', 'session-session-4', 'session-session-3', 'session-session-2',
    ]);
    expect(recent[0]).toMatchObject({ title: 'Shared 6', subtitle: '/project/6' });
    await recent[0]!.action();
    expect(params.nav.navigateToSession).toHaveBeenCalledWith('session-6');
  });

  it('retains readable fallback labels when a session has no name or path', () => {
    const params = createParams();
    params.sessionsById = { abcdef123: { id: 'abcdef123', updatedAt: 1, metadata: {} } };
    const recent = buildCommandPaletteCommands(params).find((command) => command.id === 'session-abcdef123');

    expect(recent?.title).toContain('abcdef');
    expect(recent?.subtitle).toBeTruthy();
  });

  it('uses registry-derived shortcut labels and omits stale display-only labels', () => {
    const commands = buildCommandPaletteCommands({
      ...createParams(),
      shortcutLabels: { 'commandPalette.open': 'Cmd+K', 'session.new': 'Cmd+Shift+N' },
    });

    expect(commands.find((command) => command.id === 'new-session')?.shortcut).toBe('Cmd+Shift+N');
    expect(commands.find((command) => command.id === 'settings')?.shortcut).toBeUndefined();
    expect(commands.some((command) => command.shortcut === '⌘N' || command.shortcut === '⌘,')).toBe(false);
  });
});
