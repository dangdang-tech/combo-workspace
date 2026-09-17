import { beforeEach, describe, expect, it, vi } from 'vitest';

const mmkvStore = vi.hoisted(() => new Map<string, string>());
vi.mock('react-native-mmkv', () => {
  class MMKV {
    getString(key: string) { return mmkvStore.get(key); }
    set(key: string, value: string) { mmkvStore.set(key, value); }
    delete(key: string) { mmkvStore.delete(key); }
    clearAll() { mmkvStore.clear(); }
  }
  return { MMKV };
});

import { createSessionsDomain } from './sessions';
import { clearPersistence } from '@/sync/domains/state/persistence';
import {
  getSessionDraftSnapshot,
  writeExistingSessionDraft,
} from '@/sync/ops/sessionDrafts/sessionDraftRepository';

function createHarness() {
  let state: Record<string, unknown> = {
    sessions: {},
    sessionsData: null,
    sessionListViewData: null,
    sessionListViewDataByServerId: {},
    sessionScmStatus: {},
    sessionLastViewed: {},
    sessionRepositoryTreeExpandedPathsBySessionId: {},
    reviewCommentsDraftsBySessionId: {},
    reviewCommentsDraftsByWorkspaceCacheKey: {},
    actionDraftsBySessionId: {},
    isDataReady: false,
    machines: {},
    sessionMessages: {},
    settings: { groupInactiveSessionsByProject: false },
    machineDisplayById: {},
  };
  const get = () => state;
  const set = (updater: unknown) => {
    const next = typeof updater === 'function'
      ? (updater as (current: typeof state) => Partial<typeof state>)(state)
      : updater as Partial<typeof state>;
    state = { ...state, ...next };
  };
  const domain = createSessionsDomain({ get, set } as never);
  set(domain);
  return { domain, get, set };
}

function sessionFixture(id: string) {
  return {
    id,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    active: true,
    activeAt: 1,
    metadata: { machineId: 'm1', path: '/home/u/repo', homeDir: '/home/u' },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    thinking: false,
    thinkingAt: 0,
    presence: 1,
  };
}

describe('sessions domain: canonical draft cleanup', () => {
  beforeEach(() => clearPersistence());

  it('deletes the canonical repository draft with the session', () => {
    const scope = { serverId: 'server-delete', accountId: 'account-delete' } as const;
    const { domain } = createHarness();
    domain.activateSessionLocalStateScope(scope);
    domain.applySessions([sessionFixture('session-delete') as never]);
    writeExistingSessionDraft({
      scope,
      sessionId: 'session-delete',
      patch: { text: 'delete me' },
    });
    expect(getSessionDraftSnapshot(scope, { kind: 'session', sessionId: 'session-delete' })).not.toBeNull();

    domain.deleteSession('session-delete');

    expect(getSessionDraftSnapshot(scope, { kind: 'session', sessionId: 'session-delete' })).toBeNull();
  });

  it('keeps the recipient composer draft while removing revoked session context', () => {
    const scope = { serverId: 'server-revoke', accountId: 'recipient' } as const;
    const { domain, get, set } = createHarness();
    domain.activateSessionLocalStateScope(scope);
    domain.applySessions([sessionFixture('session-revoked') as never]);
    set({ sessionMessages: { 'session-revoked': { sensitiveContext: 'shared transcript' } } });
    writeExistingSessionDraft({ scope, sessionId: 'session-revoked', patch: { text: 'My unsent question' } });
    expect(getSessionDraftSnapshot(scope, { kind: 'session', sessionId: 'session-revoked' })?.document.composer.text.value).toBe('My unsent question');

    domain.deleteSession('session-revoked', { preserveComposerDraft: true });

    expect(get().sessions).not.toHaveProperty('session-revoked');
    expect(get().sessionMessages).not.toHaveProperty('session-revoked');
    expect(getSessionDraftSnapshot(scope, { kind: 'session', sessionId: 'session-revoked' })?.document.composer.text.value).toBe('My unsent question');
  });
});
