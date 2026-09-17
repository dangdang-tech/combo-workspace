import type { Command } from './types';
import type { KeyboardCommandId } from '@/keyboard';
import { t } from '@/text';

function normalizeId(value: unknown): string {
  return String(value ?? '').trim();
}

function extractRecentSessionIds(sessionsById: Record<string, any>): string[] {
  const sessions = Object.values(sessionsById ?? {});
  sessions.sort((a: any, b: any) => Number(b?.updatedAt ?? 0) - Number(a?.updatedAt ?? 0));
  return sessions
    .map((s: any) => normalizeId(s?.id))
    .filter(Boolean)
    .slice(0, 5);
}

function readSessionLabel(session: any): Readonly<{ title: string; subtitle: string }> {
  const name = typeof session?.metadata?.name === 'string' ? session.metadata.name.trim() : '';
  const title = name || t('commandPalette.commands.sessionFallbackTitle', { id: String(session?.id ?? '').slice(0, 6) });
  const path = typeof session?.metadata?.path === 'string' ? session.metadata.path.trim() : '';
  const subtitle = path || t('commandPalette.commands.sessionFallbackSubtitle');
  return { title, subtitle };
}

export function buildCommandPaletteCommands(params: Readonly<{
  sessionsById: Record<string, any>;
  shortcutLabels?: Partial<Record<KeyboardCommandId, string>>;
  nav: Readonly<{
    push: (path: string) => void;
    openNewSession: () => void;
    navigateToSession: (sessionId: string) => void;
  }>;
  auth: Readonly<{ logout: () => Promise<void> }>;
}>): Command[] {
  const { sessionsById, nav, auth } = params;

  const cmds: Command[] = [
    {
      id: 'new-session',
      title: t('commandPalette.commands.newSessionTitle'),
      subtitle: t('commandPalette.commands.newSessionSubtitle'),
      icon: 'plus-circle',
      category: t('commandPalette.commands.sessionsCategory'),
      shortcut: params.shortcutLabels?.['session.new'],
      action: nav.openNewSession,
    },
    {
      id: 'sessions',
      title: t('commandPalette.commands.viewAllSessionsTitle'),
      subtitle: t('commandPalette.commands.viewAllSessionsSubtitle'),
      icon: 'chats-circle',
      category: t('commandPalette.commands.sessionsCategory'),
      action: () => nav.push('/'),
    },
    {
      id: 'settings',
      title: t('commandPalette.commands.settingsTitle'),
      subtitle: t('commandPalette.commands.settingsSubtitle'),
      icon: 'sliders-horizontal',
      category: t('commandPalette.commands.navigationCategory'),
      shortcut: params.shortcutLabels?.['settings.open'],
      action: () => nav.push('/settings'),
    },
    {
      id: 'account',
      title: t('commandPalette.commands.accountTitle'),
      subtitle: t('commandPalette.commands.accountSubtitle'),
      icon: 'user-circle',
      category: t('commandPalette.commands.navigationCategory'),
      action: () => nav.push('/settings/account'),
    },
    {
      id: 'machines',
      title: t('settings.machines'),
      icon: 'desktop',
      category: t('commandPalette.commands.navigationCategory'),
      action: () => nav.push('/settings/machines'),
    },
    {
      id: 'connect',
      title: t('commandPalette.commands.connectTerminalTitle'),
      subtitle: t('commandPalette.commands.connectTerminalSubtitle'),
      icon: 'link',
      category: t('commandPalette.commands.navigationCategory'),
      action: () => nav.push('/scan/terminal'),
    },
  ];

  for (const sessionId of extractRecentSessionIds(sessionsById)) {
    const session = sessionsById[sessionId];
    const label = readSessionLabel(session);
    cmds.push({
      id: `session-${sessionId}`,
      title: label.title,
      subtitle: label.subtitle,
      icon: 'clock',
      category: t('commandPalette.commands.recentSessionsCategory'),
      action: () => nav.navigateToSession(sessionId),
    });
  }

  cmds.push({
    id: 'sign-out',
    title: t('commandPalette.commands.signOutTitle'),
    subtitle: t('commandPalette.commands.signOutSubtitle'),
    icon: 'sign-out',
    category: t('commandPalette.commands.systemCategory'),
    action: async () => {
      await auth.logout();
    },
  });

  return cmds;
}
