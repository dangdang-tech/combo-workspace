import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerFeaturesClientForTests } from '@/features/serverFeaturesClient';
import { deriveBoxPublicKeyFromSeed, openEncryptedDataKeyEnvelopeV1, sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { decodeBase64, encodeBase64, encrypt, getRandomBytes } from '@/api/encryption';
import type { Credentials } from '@/persistence';
import type { SpawnDaemonSessionRequest } from '@/rpc/handlers/spawnSessionOptionsContract';
import { provisionSharedSession, type SharedSessionAssignment } from './provisionSharedSession';

// HTTP and process launch are the boundaries; session creation, metadata, and crypto stay real.
vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});
vi.mock('socket.io-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('socket.io-client')>();
  const { EventEmitter } = await import('node:events');
  return { ...actual, io: () => {
    const socket = new EventEmitter();
    return Object.assign(socket, {
      connect: () => { socket.emit('connect_error', new Error('Test HTTP fallback')); },
      disconnect: () => {},
    });
  } };
});

const hostSeed = new Uint8Array(32).fill(7);
const recipientSeed = new Uint8Array(32).fill(8);
const recipientPublicKey = deriveBoxPublicKeyFromSeed(recipientSeed);
const signingKeys = tweetnacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(9));
const binding = new Uint8Array([...new TextEncoder().encode('Happy content key v1\u0000'), ...recipientPublicKey]);
const credentials: Credentials = { token: 'test-host-token', encryption: {
  type: 'dataKey', machineKey: hostSeed, publicKey: deriveBoxPublicKeyFromSeed(hostSeed),
} };
const assignment: SharedSessionAssignment = {
  entryId: 'entry', memberId: 'member-a', sourceSessionId: 'source', sessionId: null, encryptionMode: 'e2ee',
  recipient: { userId: 'user-a', signingPublicKey: Buffer.from(signingKeys.publicKey).toString('hex'),
    contentPublicKeyB64: encodeBase64(recipientPublicKey),
    contentPublicKeySigB64: encodeBase64(tweetnacl.sign.detached(binding, signingKeys.secretKey)) },
};
const childKey = new Uint8Array(32).fill(10);

function row(id: string, mode: 'plain' | 'e2ee' = 'e2ee', extra: Record<string, unknown> = {}) {
  const key = id === 'source' ? new Uint8Array(32).fill(11) : childKey;
  const metadata = { path: '/same-project', machineId: 'machine', flavor: 'codex', ...extra };
  return { id, seq: 0, createdAt: 1, updatedAt: 1, active: true, activeAt: 1,
    encryptionMode: mode, metadata: mode === 'plain' ? JSON.stringify(metadata) : encodeBase64(encrypt(key, 'dataKey', metadata)),
    metadataVersion: 1, agentState: null, agentStateVersion: 0,
    dataEncryptionKey: mode === 'plain' ? null : encodeBase64(sealEncryptedDataKeyEnvelopeV1({ dataKey: key,
      recipientPublicKey: deriveBoxPublicKeyFromSeed(hostSeed), randomBytes: getRandomBytes })) };
}

describe('provisionSharedSession', () => {
  let mode: 'plain' | 'e2ee';
  let accountMode: 'plain' | 'e2ee' | null;
  let sourceExtra: Record<string, unknown>;
  let childMode: 'plain' | 'e2ee' | null;
  let online: boolean;
  let launches: SpawnDaemonSessionRequest[];
  beforeEach(() => {
    vi.clearAllMocks(); resetServerFeaturesClientForTests(); mode = 'e2ee'; accountMode = null; sourceExtra = {}; childMode = null; online = true; launches = [];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ features: {}, capabilities: { encryption: { storagePolicy: 'optional', allowAccountOptOut: true, defaultAccountMode: 'e2ee' } } })));
    vi.mocked(axios.get).mockImplementation(async (url) => ({ status: 200, data: String(url).endsWith('/v1/account/encryption')
      ? { mode: accountMode ?? mode, updatedAt: 1 }
      : { session: String(url).endsWith('/source') ? row('source', mode, sourceExtra) : row('child', childMode ?? mode) } }));
    vi.mocked(axios.patch).mockImplementation(async () => ({ status: 200, data: { success: true, metadata: { version: 2 } } }));
  });
  afterEach(() => { vi.unstubAllGlobals(); resetServerFeaturesClientForTests(); });
  function run(overrides: Partial<Parameters<typeof provisionSharedSession>[0]> = {}) {
    return provisionSharedSession({ credentials, machineId: 'machine', assignment, isOnline: () => online,
      directTransport: { spawn: async (request) => { launches.push(request); return { success: true, sessionId: 'child' }; } },
      ...overrides });
  }

  it('creates an empty independent session in the same directory and wraps only its key for the recipient', async () => {
    const result = await run();
    expect(result.sessionId).toBe('child');
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({ directory: '/same-project', spawnNonce: 'shared-entry:member-a',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' }, transcriptStorage: 'persisted' });
    expect(launches[0]).not.toHaveProperty('resume');
    expect(launches[0]).not.toHaveProperty('pendingFirstInput');
    expect(openEncryptedDataKeyEnvelopeV1({ envelope: decodeBase64(result.encryptedDataKey!),
      recipientSecretKeyOrSeed: recipientSeed })).toEqual(childKey);
    expect(openEncryptedDataKeyEnvelopeV1({ envelope: decodeBase64(result.encryptedDataKey!),
      recipientSecretKeyOrSeed: new Uint8Array(32).fill(99) })).toBeNull();
    const patched = vi.mocked(axios.patch).mock.calls[0]?.[1] as { metadata: { ciphertext: string } };
    expect(patched.metadata.ciphertext).not.toContain('/same-project');
  });

  it('rejects a substituted recipient key before spawning', async () => {
    await expect(run({ assignment: { ...assignment, recipient: { ...assignment.recipient,
      contentPublicKeyB64: encodeBase64(new Uint8Array(32).fill(42)) } } })).rejects.toMatchObject({ code: 'recipient_key_invalid' });
    expect(launches).toHaveLength(0);
  });

  it('never exposes an account-wide legacy secret as a shared session key', async () => {
    await expect(run({ credentials: { token: 'legacy', encryption: { type: 'legacy', secret: hostSeed } } }))
      .rejects.toMatchObject({ code: 'encryption_upgrade_required' });
    expect(launches).toHaveLength(0);
  });

  it('rejects a source belonging to another machine before launching', async () => {
    sourceExtra = { machineId: 'different-machine' };
    await expect(run()).rejects.toMatchObject({ code: 'source_session_invalid' });
    expect(launches).toHaveLength(0);
  });

  it('rechecks connectivity after metadata retrieval and never launches while disconnected', async () => {
    vi.mocked(axios.get).mockImplementation(async () => { online = false; return { status: 200, data: { session: row('source') } }; });
    await expect(run()).rejects.toMatchObject({ code: 'host_offline' });
    expect(launches).toHaveLength(0);
  });

  it('preserves plaintext mode without requiring a recipient encryption key', async () => {
    mode = 'plain';
    const result = await run({ assignment: { ...assignment, encryptionMode: 'plain', recipient: {
      userId: 'user-a', signingPublicKey: null, contentPublicKeyB64: null, contentPublicKeySigB64: null } } });
    expect(result).toEqual({ sessionId: 'child' });
  });

  it.each(['plain', 'e2ee'] as const)('refuses source %s before spawning when current account creation mode differs', async (sourceMode) => {
    mode = sourceMode;
    accountMode = sourceMode === 'plain' ? 'e2ee' : 'plain';
    await expect(run({ assignment: { ...assignment, encryptionMode: sourceMode } }))
      .rejects.toMatchObject({ code: 'session_encryption_mismatch' });
    expect(launches).toHaveLength(0);
    expect(axios.patch).not.toHaveBeenCalled();
  });

  it('keeps an already provisioned child usable when the account creation preference changes', async () => {
    accountMode = 'plain';
    const result = await run({ assignment: { ...assignment, sessionId: 'child' } });
    expect(result.sessionId).toBe('child');
    expect(launches).toHaveLength(0);
  });

  it('refuses to share a child whose storage mode differs from the source', async () => {
    childMode = 'plain';
    await expect(run()).rejects.toMatchObject({ code: 'session_encryption_mismatch' });
  });

  it('re-enabling a member reuses its existing session instead of creating a new context', async () => {
    const result = await run({ assignment: { ...assignment, sessionId: 'child' } });
    expect(result.sessionId).toBe('child');
    expect(launches).toHaveLength(0);
  });
});
