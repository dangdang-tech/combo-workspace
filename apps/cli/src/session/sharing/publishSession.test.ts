import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import axios from 'axios';
import { deriveBoxPublicKeyFromSeed, TranscriptRawRecordV1Schema } from '@happier-dev/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as persistence from '@/persistence';
import { reloadConfiguration } from '@/configuration';
import { decryptStoredSessionPayload, resolveSessionEncryptionContextFromCredentials, tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import type { RawSessionRecord } from '@/session/transport/http/sessionsHttp';
import { publishSession } from './publishSession';
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
  env = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL']);
  process.env.HAPPIER_HOME_DIR = home;
  process.env.HAPPIER_SERVER_URL = 'https://relay.example.test';
  process.env.HAPPIER_WEBAPP_URL = 'https://combo.example.test';
  reloadConfiguration();
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
