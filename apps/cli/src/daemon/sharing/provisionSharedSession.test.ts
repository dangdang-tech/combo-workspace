import axios from 'axios';
import tweetnacl from 'tweetnacl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerFeaturesClientForTests } from '@/features/serverFeaturesClient';
import { deriveBoxPublicKeyFromSeed, openEncryptedDataKeyEnvelopeV1, sealEncryptedDataKeyEnvelopeV1, TranscriptRawRecordV1Schema } from '@happier-dev/protocol';
import { decodeBase64, decodeBase64 as decode, decrypt, encodeBase64, encrypt, getRandomBytes } from '@/api/encryption';
import type { Credentials } from '@/persistence';
import { openSessionDataEncryptionKey } from '@/api/client/openSessionDataEncryptionKey';
import type { SpawnDaemonSessionRequest } from '@/rpc/handlers/spawnSessionOptionsContract';
import { provisionSharedSession, type SharedSessionAssignment } from './provisionSharedSession';
import { pollSharedSessionEntry } from './sharedSessionEntryWorker';

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
  let createdChild: ReturnType<typeof row> | null;
  let snapshotMetadata: Record<string, unknown>;
  let imported: Array<{ content: unknown; localId: string }>;
  beforeEach(() => {
    vi.clearAllMocks(); resetServerFeaturesClientForTests(); mode = 'e2ee'; accountMode = null; sourceExtra = {}; childMode = null; online = true; launches = []; createdChild = null; snapshotMetadata = {}; imported = [];
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ features: {}, capabilities: { encryption: { storagePolicy: 'optional', allowAccountOptOut: true, defaultAccountMode: 'e2ee' } } })));
    vi.mocked(axios.get).mockImplementation(async (url) => ({ status: 200, data: String(url).endsWith('/v1/account/encryption')
      ? { mode: accountMode ?? mode, updatedAt: 1 }
      : { session: String(url).endsWith('/source') ? row('source', mode, sourceExtra) : (createdChild ?? row('child', childMode ?? mode, { sharedSessionEntryId: 'entry' })) } }));
    vi.mocked(axios.post).mockImplementation(async (url, body: any) => {
      if (String(url).endsWith('/v1/sessions')) {
        createdChild ??= { ...row('child', childMode ?? mode), ...body, encryptionMode: childMode ?? mode };
        return { status: 200, data: { session: createdChild, resolution: 'created' } };
      }
      if (String(url).endsWith('/messages')) {
        if (!imported.some(item => item.localId === body.localId)) imported.push(body);
        return { status: 200, data: { didWrite: true, message: { id: body.localId, seq: imported.length, localId: body.localId, createdAt: 1 } } };
      }
      throw new Error('Unexpected POST');
    });
    vi.mocked(axios.patch).mockImplementation(async () => ({ status: 200, data: { success: true, metadata: { version: 2 } } }));
  });
  afterEach(() => { vi.unstubAllGlobals(); resetServerFeaturesClientForTests(); });
  function snapshot() {
    const source = { ...row('source', mode, { ...sourceExtra, ...snapshotMetadata }), seq: 2 };
    return { v: 1 as const, session: source, messages: [
      { seq: 1, createdAt: 1, content: stored({ role: 'user', content: { type: 'text', text: 'BEFORE_SHARE_QUESTION' } }) },
      { seq: 2, createdAt: 2, content: stored({ role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'BEFORE_SHARE_ANSWER' } } }) },
    ] };
  }
  function stored(payload: unknown) {
    return mode === 'plain' ? { t: 'plain' as const, v: payload } : { t: 'encrypted' as const, c: encodeBase64(encrypt(new Uint8Array(32).fill(11), 'dataKey', payload)) };
  }
  function childPayload(value: any) {
    if (value.t === 'plain') return value.v;
    const key = openSessionDataEncryptionKey({ credential: credentials, encryptedDataEncryptionKeyBase64: createdChild!.dataEncryptionKey });
    return decrypt(key!, 'dataKey', decode(value.c));
  }
  function run(overrides: Partial<Parameters<typeof provisionSharedSession>[0]> = {}) {
    return provisionSharedSession({ credentials, machineId: 'machine', isOnline: () => online,
      directTransport: { spawn: async (request) => { launches.push(request); return { success: true, sessionId: 'child' }; } },
      ...overrides, assignment: { ...assignment, ...overrides.assignment, sourceSnapshot: Object.prototype.hasOwnProperty.call(overrides.assignment ?? {}, 'sourceSnapshot') ? overrides.assignment!.sourceSnapshot : snapshot() } });
  }

  it.each(['plain', 'e2ee'] as const)('imports readable user and assistant records in %s storage', async (storageMode) => {
    mode = storageMode;
    await run({ assignment: { ...assignment, encryptionMode: storageMode } });
    const payloads = imported.map(item => childPayload(item.content));
    expect(payloads).toHaveLength(2);
    for (const payload of payloads) expect(TranscriptRawRecordV1Schema.safeParse(payload).success).toBe(true);
    expect(payloads[0]).toMatchObject({ role: 'user', content: { type: 'text', text: 'BEFORE_SHARE_QUESTION' } });
    expect(payloads[1]).toMatchObject({ role: 'agent', content: { type: 'output', data: {
      type: 'assistant', message: { role: 'assistant', content: 'BEFORE_SHARE_ANSWER' },
    } } });
  });

  it('forks the frozen share-time context into an independent child and wraps only its key for the recipient', async () => {
    const result = await run();
    expect(result.sessionId).toBe('child');
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({ directory: '/same-project', spawnNonce: 'shared-entry:member-a',
      backendTarget: { kind: 'builtInAgent', agentId: 'codex' }, transcriptStorage: 'persisted' });
    expect(launches[0]).not.toHaveProperty('resume');
    expect(launches[0]).not.toHaveProperty('pendingFirstInput');
    expect(createdChild).not.toBeNull();
    const recipientChildKey = openEncryptedDataKeyEnvelopeV1({ envelope: decodeBase64(result.encryptedDataKey!),
      recipientSecretKeyOrSeed: recipientSeed });
    expect(recipientChildKey).toEqual(openSessionDataEncryptionKey({ credential: credentials, encryptedDataEncryptionKeyBase64: createdChild!.dataEncryptionKey }));
    expect(recipientChildKey).not.toEqual(new Uint8Array(32).fill(11));
    expect(launches[0].existingSessionId).toBe('child');
    const metadata = decrypt(recipientChildKey!, 'dataKey', decode(createdChild!.metadata)) as any;
    expect(metadata.replaySeedV1.seedText).toContain('BEFORE_SHARE_QUESTION');
    expect(metadata.replaySeedV1.seedText).toContain('BEFORE_SHARE_ANSWER');
    expect(metadata.forkV1).toMatchObject({ parentSessionId: 'source', parentCutoffSeqInclusive: 2 });
    expect(imported.map(item => {
      const payload = childPayload(item.content);
      return payload.role === 'user' ? payload.content.text : payload.content.data.message.content;
    })).toEqual(['BEFORE_SHARE_QUESTION', 'BEFORE_SHARE_ANSWER']);
    expect(vi.mocked(axios.get).mock.calls.some(([url]) => String(url).endsWith('/messages'))).toBe(false);
    expect(openEncryptedDataKeyEnvelopeV1({ envelope: decodeBase64(result.encryptedDataKey!),
      recipientSecretKeyOrSeed: new Uint8Array(32).fill(99) })).toBeNull();
    expect(createdChild!.metadata).not.toContain('/same-project');
    expect(imported.every(item => !JSON.stringify(item.content).includes('BEFORE_SHARE'))).toBe(true);
  });

  it('names the new recipient conversation after the published invitation', async () => {
    snapshotMetadata = { summary: { text: 'Technical source title', updatedAt: 1 } };
    const originalPost = vi.mocked(axios.post).getMockImplementation()!;
    vi.mocked(axios.post).mockImplementation(async (...args) => {
      if (String(args[0]).endsWith('/claim')) return { data: { assignment: {
        ...assignment, title: '  产品经理面试教练  ', sourceSnapshot: snapshot(),
      } } };
      if (String(args[0]).endsWith('/complete')) return { data: { ok: true } };
      return await originalPost(...args);
    });
    await pollSharedSessionEntry({ credentials, machineId: 'machine', isOnline: () => online,
      directTransport: { spawn: async (request) => { launches.push(request); return { success: true, sessionId: 'child' }; } },
    });
    const key = openSessionDataEncryptionKey({ credential: credentials, encryptedDataEncryptionKeyBase64: createdChild!.dataEncryptionKey });
    const metadata = decrypt(key!, 'dataKey', decode(createdChild!.metadata)) as any;
    expect(metadata.summary.text).toBe('产品经理面试教练');
    expect(snapshotMetadata.summary).toEqual({ text: 'Technical source title', updatedAt: 1 });
  });

  it('inherits the frozen owner model and excludes later source metadata and same-seq message updates', async () => {
    snapshotMetadata = { modelOverrideV1: { v: 1, modelId: 'frozen-model', updatedAt: 1 }, summary: { text: 'Frozen title', updatedAt: 1 } };
    vi.mocked(axios.get).mockImplementation(async (url) => ({ status: 200, data: String(url).endsWith('/v1/account/encryption')
      ? { mode, updatedAt: 1 } : { session: String(url).endsWith('/source') ? row('source', mode, { summary: { text: 'PRIVATE_AFTER_SHARE', updatedAt: 2 } }) : (createdChild ?? row('child', mode)) } }));
    await run();
    expect(launches[0]).toMatchObject({ modelId: 'frozen-model', modelUpdatedAt: 1 });
    const key = openSessionDataEncryptionKey({ credential: credentials, encryptedDataEncryptionKeyBase64: createdChild!.dataEncryptionKey });
    const metadata = decrypt(key!, 'dataKey', decode(createdChild!.metadata));
    expect(JSON.stringify(metadata)).not.toContain('PRIVATE_AFTER_SHARE');
    expect(JSON.stringify(imported.map(item => childPayload(item.content)))).not.toContain('PRIVATE_AFTER_SHARE');
  });

  it('rejoins the same creation identity and imports each frozen turn once after an ambiguous import response', async () => {
    const originalPost = vi.mocked(axios.post).getMockImplementation()!;
    let interrupted = false;
    vi.mocked(axios.post).mockImplementation(async (...args) => {
      const response = await originalPost(...args);
      if (String(args[0]).endsWith('/messages') && !interrupted) { interrupted = true; throw new Error('lost import acknowledgement'); }
      return response;
    });
    await expect(run()).rejects.toThrow('lost import acknowledgement');
    const childId = createdChild!.id;
    const firstCiphertext = JSON.stringify(imported[0]);
    const result = await run();
    expect(result.sessionId).toBe(childId);
    expect(imported).toHaveLength(2);
    expect(JSON.stringify(imported[0])).toBe(firstCiphertext);
    expect(launches.every(launch => launch.existingSessionId === childId && launch.spawnNonce === 'shared-entry:member-a')).toBe(true);
    expect(vi.mocked(axios.post).mock.calls.filter(([url]) => String(url).endsWith('/v1/sessions')).map(([, body]) => (body as any).tag))
      .toEqual(['shared-entry:member-a', 'shared-entry:member-a']);
  });

  it('rejects an invitation without an immutable snapshot before any network call or launch', async () => {
    await expect(run({ assignment: { ...assignment, sourceSnapshot: null } })).rejects.toMatchObject({ code: 'context_snapshot_required' });
    expect(axios.get).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled(); expect(launches).toHaveLength(0);
  });

  it('refuses fork ancestry outside the snapshot instead of fetching live parent history', async () => {
    snapshotMetadata = { forkV1: { v: 1, parentSessionId: 'private-parent', parentCutoffSeqInclusive: 4 } };
    await expect(run()).rejects.toMatchObject({ code: 'context_snapshot_unavailable' });
    expect(axios.get).not.toHaveBeenCalled(); expect(launches).toHaveLength(0);
  });

  it('fails closed when an encrypted snapshot turn cannot be opened', async () => {
    const frozen = snapshot(); frozen.messages[0].content = { t: 'encrypted', c: 'corrupt' };
    await expect(run({ assignment: { ...assignment, sourceSnapshot: frozen } })).rejects.toMatchObject({ code: 'context_snapshot_unavailable' });
    expect(launches).toHaveLength(0); expect(imported).toHaveLength(0);
  });

  it('allows a genuinely empty frozen source and does not invent a user prompt', async () => {
    const frozen = snapshot(); frozen.messages = []; frozen.session.seq = 0;
    const result = await run({ assignment: { ...assignment, sourceSnapshot: frozen } });
    expect(result.sessionId).toBe('child'); expect(imported).toHaveLength(0);
    expect(launches[0]).not.toHaveProperty('pendingFirstInput');
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

  it('rechecks connectivity after account policy retrieval and never launches while disconnected', async () => {
    vi.mocked(axios.get).mockImplementation(async () => { online = false; return { status: 200, data: { mode, updatedAt: 1 } }; });
    await expect(run()).rejects.toMatchObject({ code: 'host_offline' });
    expect(launches).toHaveLength(0);
  });

  it('preserves plaintext mode without requiring a recipient encryption key', async () => {
    mode = 'plain';
    const result = await run({ assignment: { ...assignment, encryptionMode: 'plain', recipient: {
      userId: 'user-a', signingPublicKey: null, contentPublicKeyB64: null, contentPublicKeySigB64: null } } });
    expect(result).toMatchObject({ sessionId: 'child' });
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
    await expect(run({ assignment: { ...assignment, sessionId: 'child' } })).rejects.toMatchObject({ code: 'session_encryption_mismatch' });
  });

  it.each(['plain', 'e2ee'] as const)('restores a legacy %s member only to its existing child without fetching or copying source history', async (existingMode) => {
    mode = existingMode;
    createdChild = row('child', existingMode, { sharedSessionEntryId: 'entry', summary: { text: 'Existing member conversation', updatedAt: 3 } });
    const originalMetadata = createdChild.metadata;
    const result = await run({ assignment: { ...assignment, sessionId: 'child', encryptionMode: existingMode, sourceSnapshot: null } });
    expect(result).toMatchObject({ sessionId: 'child', contextSnapshotVersion: 1 });
    expect(launches).toHaveLength(0); expect(imported).toHaveLength(0);
    expect(createdChild.metadata).toBe(originalMetadata);
    expect(vi.mocked(axios.get).mock.calls.map(([url]) => String(url))).toEqual([expect.stringMatching(/\/v2\/sessions\/child$/)]);
    expect(axios.post).not.toHaveBeenCalled(); expect(axios.patch).not.toHaveBeenCalled();
    if (existingMode === 'e2ee') {
      expect(openEncryptedDataKeyEnvelopeV1({ envelope: decodeBase64(result.encryptedDataKey!), recipientSecretKeyOrSeed: recipientSeed })).toEqual(childKey);
    }
  });

  it.each([{ machineId: 'other-machine', sharedSessionEntryId: 'entry' }, { sharedSessionEntryId: 'other-entry' }, {}])(
    'rejects an unrelated legacy child before resealing its key: %j', async (metadata) => {
      createdChild = row('child', mode, metadata);
      await expect(run({ assignment: { ...assignment, sessionId: 'child', sourceSnapshot: null } })).rejects.toMatchObject({ code: 'child_session_invalid' });
      expect(launches).toHaveLength(0); expect(axios.post).not.toHaveBeenCalled();
    },
  );

  it('re-enabling a member reuses its existing session instead of creating a new context', async () => {
    const result = await run({ assignment: { ...assignment, sessionId: 'child' } });
    expect(result.sessionId).toBe('child');
    expect(launches).toHaveLength(0);
  });
});
