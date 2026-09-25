import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deriveBoxPublicKeyFromSeed, sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { encodeBase64, encrypt } from '@/api/encryption';
import { resolveSessionEncryptionContextFromCredentials } from '@/session/transport/encryption/sessionEncryptionContext';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { reloadConfiguration } from '@/configuration';
import type { Credentials } from '@/persistence';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createExternalMcpServer } from '@/mcp/createExternalMcpServer';
import { createCliActionExecutorFromCredentials } from './createCliActionExecutorFromCredentials';
import { createCliActionDeps } from './createCliActionDeps';

const childId = 'caaaaaaaaaaaaaaaaaaaaaaaa';
const ownerId = 'cbbbbbbbbbbbbbbbbbbbbbbbb';
const machineKey = new Uint8Array(32).fill(5);
const publicKey = deriveBoxPublicKeyFromSeed(machineKey);
const sessionDataKey = new Uint8Array(32).fill(9);
const credentials: Credentials = { token: 'fixture-token', encryption: { type: 'dataKey', machineKey, publicKey } };
const ctx = resolveSessionEncryptionContextFromCredentials(credentials);
const source = { kind: 'session' as const, sessionId: ownerId };
const published = { sourceSessionId: ownerId, entryId: 'entry-1', inviteUrl: 'https://combo.example.test/invite/fixture-invite?server=https%3A%2F%2Frelay.example.test' };
type Handler = (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
let home: string;
let env: ReturnType<typeof createEnvKeyScope>;
let callerUnavailable: boolean;
const reads: string[] = [];
const writes: string[] = [];
const handlers = new Map<string, Handler>();
const row = (id: string) => ({
  id, seq: 0, createdAt: 1, updatedAt: 1, active: false, activeAt: 0,
  metadata: id === childId
    ? encodeBase64(encrypt(sessionDataKey, 'dataKey', { machineId: 'fixture-machine', path: '/fixture/project', sharedSessionEntryId: 'shared-entry' }))
    : JSON.stringify({ machineId: 'fixture-machine', path: '/fixture/project' }),
  metadataVersion: 1, agentState: null, agentStateVersion: 0,
  dataEncryptionKey: id === childId ? encodeBase64(sealEncryptedDataKeyEnvelopeV1({ dataKey: sessionDataKey, recipientPublicKey: publicKey, randomBytes: (length) => new Uint8Array(length).fill(3) })) : null,
  encryptionMode: id === childId ? 'e2ee' : 'plain',
});

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'combo-publish-caller-'));
  env = createEnvKeyScope(['HAPPIER_HOME_DIR', 'HAPPIER_SERVER_URL', 'HAPPIER_WEBAPP_URL', 'HAPPIER_SESSION_ID', 'HAPPIER_ACTIONS_SETTINGS_V1']);
  process.env.HAPPIER_HOME_DIR = home;
  process.env.HAPPIER_SERVER_URL = 'https://relay.example.test';
  process.env.HAPPIER_WEBAPP_URL = 'https://combo.example.test';
  delete process.env.HAPPIER_SESSION_ID;
  delete process.env.HAPPIER_ACTIONS_SETTINGS_V1;
  reloadConfiguration();
  callerUnavailable = false; reads.length = 0; writes.length = 0; handlers.clear();
  vi.spyOn(axios, 'get').mockImplementation(async (url) => {
    const value = String(url); reads.push(value);
    if (value.endsWith(`/v2/sessions/${childId}`)) {
      if (callerUnavailable) throw new Error('caller metadata unavailable');
      return { status: 200, data: { session: row(childId) } };
    }
    if (value.endsWith(`/v2/sessions/${ownerId}`)) return { status: 200, data: { session: row(ownerId) } };
    throw new Error(`Unexpected fixture GET ${value}`);
  });
  vi.spyOn(axios, 'post').mockImplementation(async (url) => {
    writes.push(String(url));
    if (String(url).endsWith('/v1/shared-session-entries')) return {
      status: 200, data: { entry: { id: 'entry-1', sourceSessionId: ownerId, machineId: 'fixture-machine', createdAt: 1 }, inviteToken: 'fixture-invite' },
    };
    throw new Error(`Unexpected fixture POST ${String(url)}`);
  });
  // Third-party MCP transport boundary: keep the real registration, action bridge, and HTTP owner.
  vi.spyOn(McpServer.prototype, 'registerTool').mockImplementation((name, _config, callback) => {
    handlers.set(name, callback as unknown as Handler);
    return {} as ReturnType<McpServer['registerTool']>;
  });
});
afterEach(async () => { vi.restoreAllMocks(); env.restore(); reloadConfiguration(); await rm(home, { recursive: true, force: true }); });

async function mcpResult(name: string, input: unknown) {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`Missing tool ${name}`);
  const output = await handler(input);
  return { ...output, value: JSON.parse(output.content[0]?.text ?? '{}') as Record<string, unknown> };
}

describe('session.publish caller authority', () => {
  it.each([
    { kind: 'session' as const, sessionId: childId },
    source,
    { kind: 'codex' as const, threadId: 'explicit-native', codexHome: '/must-not-read-native' },
  ])('denies every publication from a bound shared child before accessing target %j', async (selectedSource) => {
    const deps = createCliActionDeps({ credentials, token: credentials.token, sessionId: childId, ctx,
      currentSessionPermissionAuthority: 'trusted_runtime', rawSession: { metadata: { machineId: 'fixture-machine' } } });
    await expect(deps.sessionPublish!({ source: selectedSource, title: 'Disallowed' })).resolves.toMatchObject({ ok: false, errorCode: 'shared_session_publish_forbidden' });
    expect(reads).toContain(`https://relay.example.test/v2/sessions/${childId}`);
    expect(reads).not.toContain(`https://relay.example.test/v2/sessions/${ownerId}`);
    expect(writes).toEqual([]);
  });

  it('fails closed when a bound caller cannot be verified instead of trusting cached metadata', async () => {
    callerUnavailable = true;
    const deps = createCliActionDeps({ credentials, token: credentials.token, sessionId: childId, ctx, rawSession: { metadata: {} } });
    await expect(deps.sessionPublish!({ source, title: 'Unverified' })).resolves.toMatchObject({ ok: false, errorCode: 'caller_session_unavailable' });
    expect(writes).toEqual([]);
  });

  it('keeps the ambient CLI child restriction even when an owner source is explicitly supplied', async () => {
    process.env.HAPPIER_SESSION_ID = childId;
    const executor = createCliActionExecutorFromCredentials({ credentials });
    await expect(executor.execute('session.publish', { source, title: 'Disallowed' }, { surface: 'cli' })).resolves.toMatchObject({ ok: false, errorCode: 'shared_session_publish_forbidden' });
    expect(writes).toEqual([]);
  });

  it.each(['initial', 'ambient'] as const)('keeps immutable external MCP %s child authority after target selection changes', async (binding) => {
    if (binding === 'ambient') process.env.HAPPIER_SESSION_ID = childId;
    createExternalMcpServer({ credentials, ...(binding === 'initial' ? { defaultSessionId: childId } : {}) });
    expect((await mcpResult('session_target_primary_set', { sessionId: ownerId })).isError).toBe(false);
    const output = await mcpResult('session_publish', { source, title: 'Disallowed' });
    expect(output).toMatchObject({ isError: true, value: { errorCode: 'shared_session_publish_forbidden' } });
    expect(reads).toContain(`https://relay.example.test/v2/sessions/${childId}`);
    expect(writes).toEqual([]);
  });

  it.each(['cli-global', ownerId])('allows an unbound or verified ordinary owner caller %s', async (sessionId) => {
    const deps = createCliActionDeps({ credentials, token: credentials.token, sessionId, ctx });
    await expect(deps.sessionPublish!({ source, title: 'Allowed' })).resolves.toEqual(published);
    expect(writes).toEqual(['https://relay.example.test/v1/shared-session-entries']);
  });
});
