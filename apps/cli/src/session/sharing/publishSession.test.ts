import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import axios from 'axios';
import { deriveBoxPublicKeyFromSeed, TranscriptRawRecordV1Schema } from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as persistence from '@/persistence';
import { reloadConfiguration } from '@/configuration';
import { logger } from '@/utils/logger';
import { decryptStoredSessionPayload, resolveSessionEncryptionContextFromCredentials, tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import type { RawSessionRecord } from '@/session/transport/http/sessionsHttp';
import { publishSession, previewNativeSessionPublication } from './publishSession';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import { registerMachineDirectSessionsRpcHandlers } from '@/api/machine/rpcHandlers.directSessions';
import type { RpcHandler } from '@/api/rpc/types';
import { decryptTranscriptReplaySlice } from '@/session/replay/decryptTranscriptReplaySlice';

let home: string;
let env: ReturnType<typeof createEnvKeyScope>;
const machineKey = new Uint8Array(32).fill(41);
const credentials: persistence.Credentials = { token: 'fixture-token', encryption: { type: 'dataKey', machineKey, publicKey: deriveBoxPublicKeyFromSeed(machineKey) } };
const requestBodies: Array<{ url: string; data: any }> = [];
let source: RawSessionRecord | null;
let entry: Record<string, unknown> | null;
let rejectCommit: boolean;
let failCommitAfter: number | null;
let rejectPublishResponse: boolean;
let messages: Map<string, any>;
const rawSession = (data: any): RawSessionRecord => ({ id: 'imported-source', seq: 0, createdAt: 1, updatedAt: 1, active: false, activeAt: 0, metadata: data.metadata, metadataVersion: 1, agentState: null, agentStateVersion: 0, dataEncryptionKey: data.dataEncryptionKey, encryptionMode: 'e2ee' });
async function nativeFixture(tail = '') {
  const codexHome = join(home, 'codex');
  await mkdir(join(codexHome, 'sessions'), { recursive: true });
  const lines = [
    { type: 'session_meta', payload: { id: 'exact-thread', cwd: '/owned/project' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'prior question' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'prior answer' }] } },
  ];
  const file = join(codexHome, 'sessions', 'rollout-2026-09-23T00-00-00-exact-thread.jsonl');
  await writeFile(file, lines.map((line) => JSON.stringify(line)).join('\n') + '\n' + tail);
  return { codexHome, file };
}

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'combo-publish-http-'));
  env = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL', 'CODEX_HOME']);
  process.env.HAPPIER_HOME_DIR = home;
  process.env.CODEX_HOME = join(home, 'codex');
  process.env.HAPPIER_SERVER_URL = 'https://relay.example.test';
  process.env.HAPPIER_WEBAPP_URL = 'https://combo.example.test';
  reloadConfiguration();
  vi.spyOn(persistence, 'readCredentials').mockResolvedValue(credentials);
  vi.spyOn(persistence, 'readSettings').mockResolvedValue({ schemaVersion: 6, onboardingCompleted: true, machineId: 'local-machine' });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
  source = null; entry = null; rejectCommit = false; failCommitAfter = null; rejectPublishResponse = false; messages = new Map(); requestBodies.length = 0;
  vi.spyOn(axios, 'get').mockImplementation(async (url) => {
    if (String(url).endsWith('/v1/shared-session-entries')) return { status: 200, data: { entries: entry ? [entry] : [] } };
    if (String(url).endsWith('/invite')) return { status: 200, data: { inviteToken: 'stable-token' } };
    if (String(url).includes('/v2/sessions/imported-source')) return { status: source ? 200 : 404, data: { session: source } };
    if (String(url).includes('/v2/sessions')) return { status: 200, data: { sessions: source ? [source] : [], hasNext: false, nextCursor: null } };
    throw new Error(`Unexpected GET ${url}`);
  });
  vi.spyOn(axios, 'post').mockImplementation(async (url, data: any) => {
    requestBodies.push({ url: String(url), data });
    if (String(url).endsWith('/v1/sessions')) {
      if (!source) source = rawSession(data);
      return { status: 200, data: { session: source } };
    }
    if (String(url).endsWith('/messages')) {
      if (rejectCommit || (failCommitAfter !== null && !messages.has(data.localId) && messages.size >= failCommitAfter)) throw new Error('message write was not acknowledged');
      const had = messages.has(data.localId);
      if (!had) messages.set(data.localId, data.content);
      return { status: 200, data: { didWrite: !had, message: { id: `message-${messages.size}`, seq: messages.size, localId: data.localId, createdAt: 1 } } };
    }
    if (String(url).endsWith('/v1/shared-session-entries')) {
      expect(messages.size).toBe(2);
      entry = { id: 'entry-1', title: data.title, sourceSessionId: 'imported-source', machineId: 'local-machine', hasContextSnapshot: true, hasReusableInvite: true, createdAt: 1 };
      if (rejectPublishResponse) throw new Error('publish response lost after commit');
      return { status: 200, data: { entry, inviteToken: 'stable-token' } };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); env.restore(); reloadConfiguration(); await rm(home, { recursive: true, force: true }); });

describe('publishSession', () => {
  it('rejects a capture that exceeds the actual replay framing budget before preview or publication writes', async () => {
    const f = await nativeFixture();
    const rows = await readFile(f.file, 'utf8');
    await writeFile(f.file, rows.replace('prior answer', 'x'.repeat(120_000)));
    const target = { credentials, source: { kind: 'codex' as const, threadId: 'exact-thread', codexHome: f.codexHome } };
    await expect(previewNativeSessionPublication(target)).rejects.toMatchObject({ code: 'context_snapshot_too_large' });
    await expect(publishSession({ ...target, title: 'Too long' })).rejects.toMatchObject({ code: 'context_snapshot_too_large' });
    expect(requestBodies).toHaveLength(0);
  });
  it.each([{ label: 'changed text', answer: 'changed after partial import' }, { label: 'beyond replay budget', answer: 'x'.repeat(120_000) }])('never mixes a partially imported capture with subsequently changed native text ($label)', async ({ answer }) => {
    const f = await nativeFixture();
    const target = { credentials, source: { kind: 'codex' as const, threadId: 'exact-thread', codexHome: f.codexHome } };
    failCommitAfter = 1;
    await expect(publishSession({ ...target, title: 'Partial' })).rejects.toThrow('not acknowledged');
    await writeFile(f.file, (await readFile(f.file, 'utf8')).replace('prior answer', answer));
    const writesBefore = requestBodies.length;
    await expect(previewNativeSessionPublication(target)).rejects.toMatchObject({ code: 'publication_capture_conflict' });
    await expect(publishSession({ ...target, title: 'Partial' })).rejects.toMatchObject({ code: 'publication_capture_conflict' });
    expect(messages.size).toBe(1);
    expect(requestBodies.slice(writesBefore).some((request) => request.url.endsWith('/messages') || request.url.endsWith('/v1/shared-session-entries'))).toBe(false);
  });
  it('serves authenticated RPC preview and publication only from the daemon configured home', async () => {
    await nativeFixture();
    const handlers = new Map<string, unknown>();
    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager: { registerHandler: (method, handler) => handlers.set(method, handler) } });
    // The transport fixture dispatches unknown wire payloads; each real handler validates its schema.
    const preview = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_PUBLISH_PREVIEW) as RpcHandler<unknown, unknown> | undefined;
    const publish = handlers.get(RPC_METHODS.DAEMON_DIRECT_SESSION_PUBLISH) as RpcHandler<unknown, unknown> | undefined;
    expect(typeof preview).toBe('function');
    expect(typeof publish).toBe('function');
    if (!preview || !publish) throw new Error('Publication RPC unavailable');
    const target = { machineId: 'local-machine', providerId: 'codex', source: { kind: 'codexHome', home: 'user' }, remoteSessionId: 'exact-thread' };
    expect(await preview({ ...target, source: { ...target.source, homePath: '/arbitrary/private-home' } })).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(await preview({ ...target, machineId: 'other-host' })).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(await preview({ ...target, remoteSessionId: '../thread' })).toMatchObject({ ok: false, errorCode: 'invalid_request' });
    expect(requestBodies).toHaveLength(0);
    const reviewed = await preview(target) as { ok: boolean; status: string; snapshotFingerprint: string };
    expect(reviewed).toMatchObject({ ok: true, status: 'ready' });
    expect(requestBodies).toHaveLength(0);
    expect(await publish({ ...target, title: 'RPC publication', expectedSnapshotFingerprint: reviewed.snapshotFingerprint })).toMatchObject({ ok: true, publication: { entryId: 'entry-1' } });
    vi.mocked(persistence.readCredentials).mockResolvedValue(null);
    expect(await preview(target)).toMatchObject({ ok: false, errorCode: 'not_authenticated' });
  });


  it.each(['preview', 'publish'] as const)('logs safe %s failure diagnostics without leaking HTTP or session data', async (phase) => {
    await nativeFixture();
    const handlers = new Map<string, unknown>();
    registerMachineDirectSessionsRpcHandlers({ rpcHandlerManager: { registerHandler: (method, handler) => handlers.set(method, handler) } });
    // The RPC transport fixture passes unknown wire data to the real schema-validating handler.
    const method = phase === 'preview' ? RPC_METHODS.DAEMON_DIRECT_SESSION_PUBLISH_PREVIEW : RPC_METHODS.DAEMON_DIRECT_SESSION_PUBLISH;
    const handler = handlers.get(method) as RpcHandler<unknown, unknown>;
    const sensitive = 'PRIVATE_AUTH_CHAT_TITLE_PATH_THREAD';
    const knownTransportFailure = phase === 'preview';
    const httpFailure = Object.assign(new Error(sensitive), {
      name: knownTransportFailure ? 'AxiosError' : sensitive,
      code: knownTransportFailure ? 'ECONNRESET' : sensitive,
      response: { status: knownTransportFailure ? 503 : sensitive, data: { text: sensitive } },
      config: { headers: { Authorization: credentials.token }, url: `${sensitive}/private`, data: sensitive },
      request: { body: sensitive },
    });
    vi.mocked(axios.get).mockRejectedValueOnce(httpFailure);
    const warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const result = await handler({ machineId: 'local-machine', providerId: 'codex',
      source: { kind: 'codexHome', home: 'user' }, remoteSessionId: 'exact-thread',
      title: sensitive, expectedSnapshotFingerprint: '0'.repeat(64) });
    expect(result).toEqual({ ok: false, errorCode: 'internal_error', error: 'internal_error' });
    expect(warnings).toHaveBeenCalledWith('[DIRECT SESSION PUBLICATION] Failed', {
      phase, errorName: knownTransportFailure ? 'AxiosError' : 'UnknownError',
      code: knownTransportFailure ? 'ECONNRESET' : null, httpStatus: knownTransportFailure ? 503 : null,
    });
    const logged = JSON.stringify(warnings.mock.calls);
    for (const excluded of [sensitive, credentials.token, 'exact-thread', '/owned/project', 'prior question', 'prior answer', home]) {
      expect(logged).not.toContain(excluded);
    }
    expect(requestBodies).toHaveLength(0);
  });

  it('refuses publication before any write when the reviewed native snapshot changed', async () => {
    const f = await nativeFixture();
    await expect(publishSession({
      credentials, source: { kind: 'codex', threadId: 'exact-thread', codexHome: f.codexHome },
      title: 'Reviewed copy', expectedSnapshotFingerprint: '0'.repeat(64),
    })).rejects.toMatchObject({ code: 'snapshot_changed' });
    expect(requestBodies).toHaveLength(0);
  });
  it('previews only the exact text without creating a source, then publishes that reviewed capture', async () => {
    const f = await nativeFixture();
    const target = { credentials, source: { kind: 'codex' as const, threadId: 'exact-thread', codexHome: f.codexHome } };
    const preview = await previewNativeSessionPublication(target);
    expect(preview).toMatchObject({ status: 'ready', directory: '/owned/project', messages: [
      { role: 'user', text: 'prior question' }, { role: 'assistant', text: 'prior answer' },
    ] });
    expect(requestBodies).toHaveLength(0);
    if (preview.status !== 'ready') throw new Error('expected a new snapshot');
    expect(preview.snapshotFingerprint).toMatch(/^[a-f0-9]{64}$/);
    await expect(publishSession({ ...target, title: 'Reviewed copy', expectedSnapshotFingerprint: preview.snapshotFingerprint }))
      .resolves.toMatchObject({ entryId: 'entry-1' });
    expect(messages.size).toBe(2);
  });
  it('requires a new preview when native text is appended after review', async () => {
    const f = await nativeFixture();
    const target = { credentials, source: { kind: 'codex' as const, threadId: 'exact-thread', codexHome: f.codexHome } };
    const preview = await previewNativeSessionPublication(target);
    if (preview.status !== 'ready') throw new Error('expected a new snapshot');
    await nativeFixture(JSON.stringify({ type: 'response_item', payload: {
      type: 'message', role: 'user', content: [{ type: 'input_text', text: 'not approved in preview' }],
    } }) + '\n');
    await expect(publishSession({ ...target, title: 'Reviewed copy', expectedSnapshotFingerprint: preview.snapshotFingerprint }))
      .rejects.toMatchObject({ code: 'snapshot_changed' });
    expect(requestBodies).toHaveLength(0);
  });
  it('previews an existing publication as its original link without displaying newly appended native text', async () => {
    const f = await nativeFixture();
    const target = { credentials, source: { kind: 'codex' as const, threadId: 'exact-thread', codexHome: f.codexHome } };
    const published = await publishSession({ ...target, title: 'Original' });
    requestBodies.length = 0;
    await writeFile(f.file, '{native is writing an unrelated later turn');
    const preview = await previewNativeSessionPublication(target);
    expect(preview).toEqual({ status: 'already_published', publication: published });
    expect(preview).not.toHaveProperty('messages');
    await expect(publishSession({ ...target, title: 'Changed title', expectedSnapshotFingerprint: '0'.repeat(64) }))
      .resolves.toEqual(published);
    expect(requestBodies).toHaveLength(0);
  });
  it('imports native text into a new encrypted source, awaits every commit, and publishes a configured public URL', async () => {
    const f = await nativeFixture();
    const result = await publishSession({ credentials, source: { kind: 'codex', threadId: 'exact-thread', codexHome: f.codexHome }, title: 'Shared project', description: 'A public description' });
    expect(result).toEqual({ sourceSessionId: 'imported-source', entryId: 'entry-1', inviteUrl: 'https://combo.example.test/invite/stable-token?server=https%3A%2F%2Frelay.example.test' });
    const metadata = tryDecryptSessionMetadata({ credentials, rawSession: source! });
    expect(metadata).toMatchObject({ machineId: 'local-machine', path: '/owned/project', flavor: 'codex' });
    expect(metadata).not.toHaveProperty('codexSessionId');
    expect(metadata).not.toHaveProperty('directSessionV1');
    const ctx = resolveSessionEncryptionContextFromCredentials(credentials, source!);
    expect(ctx.encryptionKey).not.toEqual(machineKey);
    const plain = [...messages.values()].map((message) => decryptStoredSessionPayload({ mode: 'e2ee', ctx, value: message.c }));
    for (const raw of plain) expect(TranscriptRawRecordV1Schema.safeParse(raw).success).toBe(true);
    const replay = decryptTranscriptReplaySlice({
      rows: [...messages.values()].map((content, i) => ({ seq: i + 1, createdAt: 1, content })),
      encryptionKey: ctx.encryptionKey, encryptionVariant: ctx.encryptionVariant,
    });
    expect(replay.unreadableRowCount).toBe(0);
    expect(replay.dialog.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'User', text: 'prior question' }, { role: 'Assistant', text: 'prior answer' },
    ]);
    expect(plain).toEqual([{ role: 'user', content: { type: 'text', text: 'prior question' } }, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'prior answer' } } }]);
    expect(requestBodies.at(-1)?.data).toMatchObject({ sourceSessionId: result.sourceSessionId, machineId: 'local-machine', reuseExisting: true, publicMetadata: { v: 1, description: 'A public description' } });
  });
  it('does not publish when a transcript write lacks its acknowledgement; retry reuses the same source', async () => {
    const f = await nativeFixture();
    const params = { credentials, source: { kind: 'codex' as const, threadId: 'exact-thread', codexHome: f.codexHome }, title: 'Shared project' };
    rejectCommit = true;
    await expect(publishSession(params)).rejects.toThrow('not acknowledged');
    expect(requestBodies.some((request) => request.url.endsWith('/v1/shared-session-entries'))).toBe(false);
    const failedSource = source;
    rejectCommit = false;
    const result = await publishSession(params);
    expect(source).toBe(failedSource);
    expect(result.sourceSessionId).toBe('imported-source');
    expect(messages.size).toBe(2);
  });
  it('retries a partially acknowledged native import after archival without duplicating its history or source key', async () => {
    const f = await nativeFixture();
    const params = { credentials, source: { kind: 'codex' as const, threadId: 'exact-thread', codexHome: f.codexHome }, title: 'Shared project' };
    failCommitAfter = 1;
    await expect(publishSession(params)).rejects.toThrow('not acknowledged');
    expect(messages.size).toBe(1);
    const encryptionKey = source!.dataEncryptionKey;
    await mkdir(join(f.codexHome, 'archived_sessions'));
    await rename(f.file, join(f.codexHome, 'archived_sessions', basename(f.file)));
    failCommitAfter = null;
    await expect(publishSession(params)).resolves.toMatchObject({ sourceSessionId: 'imported-source', entryId: 'entry-1' });
    expect(messages.size).toBe(2);
    expect(source!.dataEncryptionKey).toBe(encryptionKey);
  });
  it('recovers a committed publication with the same URL without rereading or growing its native source', async () => {
    const f = await nativeFixture();
    const params = { credentials, source: { kind: 'codex' as const, threadId: 'exact-thread', codexHome: f.codexHome }, title: 'Shared project' };
    rejectPublishResponse = true;
    await expect(publishSession(params)).rejects.toThrow('response lost');
    const writesBefore = requestBodies.filter((request) => request.url.endsWith('/messages')).length;
    await writeFile(f.file, '{partial native write');
    const result = await publishSession(params);
    expect(result.inviteUrl).toContain('/invite/stable-token');
    expect(requestBodies.filter((request) => request.url.endsWith('/messages'))).toHaveLength(writesBefore);
    expect(requestBodies.filter((request) => request.url.endsWith('/v1/sessions'))).toHaveLength(1);
  });
  it('publishes an existing COMBO session without importing native files or creating another source', async () => {
    const f = await nativeFixture();
    await publishSession({ credentials, source: { kind: 'codex', threadId: 'exact-thread', codexHome: f.codexHome }, title: 'Initial' });
    requestBodies.length = 0;
    const result = await publishSession({ credentials, source: { kind: 'session', sessionId: 'imported-source' }, title: 'Existing source' });
    expect(result.sourceSessionId).toBe('imported-source');
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]?.url).toBe('https://relay.example.test/v1/shared-session-entries');
  });
  it('rejects a native host mismatch before reading or creating any session', async () => {
    await expect(publishSession({ credentials, source: { kind: 'codex', threadId: 'exact-thread', codexHome: '/not/read' }, machineId: 'other-host', title: 'X' })).rejects.toThrow(/machine|host/i);
    expect(requestBodies).toHaveLength(0);
  });
});
