import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpawnDaemonSessionRequest } from '@/rpc/handlers/spawnSessionOptionsContract';
import { pollSharedSessionEntry } from './sharedSessionEntryWorker';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const assignment = { entryId: 'entry', memberId: 'member', sourceSessionId: 'source', sessionId: 'child',
  encryptionMode: 'plain', sourceSnapshot: { v: 1, session: session('source'), messages: [] }, recipient: { userId: 'user', signingPublicKey: null, contentPublicKeyB64: null, contentPublicKeySigB64: null } };
function session(id: string) {
  return { id, seq: 0, createdAt: 1, updatedAt: 1, active: true, activeAt: 1, encryptionMode: 'plain',
    metadata: JSON.stringify({ path: '/same', machineId: 'machine', flavor: 'codex', sharedSessionEntryId: 'entry' }),
    metadataVersion: 1, agentState: null, agentStateVersion: 0, dataEncryptionKey: null };
}
describe('shared entry daemon polling', () => {
  let online: boolean;
  let launches: SpawnDaemonSessionRequest[];
  beforeEach(() => {
    vi.clearAllMocks(); online = true; launches = [];
    vi.mocked(axios.get).mockImplementation(async (url) => ({ status: 200,
      data: { session: session(String(url).endsWith('/source') ? 'source' : 'child') } }));
    vi.mocked(axios.post).mockImplementation(async (url) => ({ data: String(url).endsWith('/claim') ? { assignment } : { ok: true } }));
  });
  function poll() {
    return pollSharedSessionEntry({ credentials: { token: 'host', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      machineId: 'machine', isOnline: () => online,
      directTransport: { spawn: async (request) => { launches.push(request); return { success: true, sessionId: 'child' }; } } });
  }

  it('finishes the canonical member allocation with the existing private child', async () => {
    await poll();
    expect(vi.mocked(axios.post).mock.calls.map(([url, body]) => [String(url).split('/shared-session-entries')[1], body]))
      .toEqual([['/claim', {}], ['/member/complete', { sessionId: 'child', contextSnapshotVersion: 1 }]]);
    expect(launches).toHaveLength(0);
  });

  it('does not claim or create a session while offline', async () => {
    online = false;
    await poll();
    expect(axios.post).not.toHaveBeenCalled();
    expect(launches).toHaveLength(0);
  });

  it('stops after a disconnect during claim without launching or falsely completing', async () => {
    vi.mocked(axios.post).mockImplementation(async () => { online = false; return { data: { assignment } }; });
    await poll();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.get).not.toHaveBeenCalled();
    expect(launches).toHaveLength(0);
  });

  it('reports a bounded error for malformed source metadata without sending private exception details', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { assignment: { ...assignment, sessionId: null, sourceSnapshot: { v: 1, session: { ...session('source'), metadata: '{}' }, messages: [] } } } });
    await poll();
    expect(vi.mocked(axios.post).mock.calls.at(-1)?.slice(0, 2)).toEqual([
      expect.stringContaining('/member/fail'), { errorCode: 'source_session_invalid' },
    ]);
    expect(launches).toHaveLength(0);
  });

  it('leaves an ambiguous completion retryable instead of changing it to a failed or new context', async () => {
    vi.mocked(axios.post).mockImplementation(async (url) => {
      if (String(url).endsWith('/complete')) throw new Error('transport disconnected');
      return { data: { assignment } };
    });
    await expect(poll()).rejects.toThrow('transport disconnected');
    expect(vi.mocked(axios.post).mock.calls.some(([url]) => String(url).endsWith('/fail'))).toBe(false);
  });
});
