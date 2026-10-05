import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { io, type Socket } from 'socket.io-client';

type Fixture = { baseUrl: string; sourceSessionId: string; machineId: string; projectDir: string; ownerToken: string; recipientToken: string; outsiderToken: string };
let fixture: Fixture;
let baseDir: string;
let server: ChildProcess;
let hostSocket: Socket;
let client: import('@/api/session/sessionClient').ApiSessionClient | undefined;
let runtimeActivity: import('@/session/runtimeActivity/types').SessionRuntimeActivity | undefined;

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (!await check()) {
        if (Date.now() > deadline) throw new Error('Synthetic flow condition timed out');
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
async function request(token: string | null, path: string, body?: unknown) {
    return fetch(`${fixture.baseUrl}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function json<T = unknown>(token: string | null, path: string, body?: unknown) {
    const response = await request(token, path, body);
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    return result as T;
}

beforeAll(async () => {
    baseDir = await mkdtemp(join(tmpdir(), 'combo-paired-flow-'));
    const listener = createServer();
    await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>(resolve => listener.close(() => resolve()));
    const ready = join(baseDir, 'ready.json');
    const log = await open(join(baseDir, 'server.log'), 'w');
    const serverDir = resolve(process.cwd(), '../server');
    server = spawn(process.execPath, [resolve(serverDir, '../../node_modules/tsx/dist/cli.mjs'), '--tsconfig', join(serverDir, 'tsconfig.json'), join(serverDir, 'sources/testkit/comboSharingFlowServer.ts'), ready, join(baseDir, 'project'), String(port)], {
        cwd: serverDir, env: { ...process.env, npm_execpath: process.env.COMBO_TEST_YARN_PATH ?? process.env.npm_execpath }, stdio: ['ignore', log.fd, log.fd],
    });
    await log.close();
    await waitFor(async () => {
        if (server.exitCode !== null) throw new Error(`Fixture failed: ${await readFile(join(baseDir, 'server.log'), 'utf8')}`);
        try { fixture = JSON.parse(await readFile(ready, 'utf8')); return true; } catch { return false; }
    }, 60_000);
    vi.stubEnv('HAPPIER_HOME_DIR', join(baseDir, 'cli-home'));
    vi.stubEnv('HAPPIER_SERVER_URL', fixture.baseUrl);
    vi.stubEnv('HAPPIER_WEBAPP_URL', fixture.baseUrl);
    vi.resetModules();
    const { writeCredentialsLegacy } = await import('@/persistence');
    await writeCredentialsLegacy({ token: fixture.ownerToken, secret: new Uint8Array(32).fill(7) });
    hostSocket = io(fixture.baseUrl, { path: '/v1/updates', transports: ['websocket'], auth: { token: fixture.ownerToken, clientType: 'machine-scoped', machineId: fixture.machineId } });
    await new Promise<void>((resolve, reject) => { hostSocket.once('connect', resolve); hostSocket.once('connect_error', reject); });
}, 90_000);

afterAll(async () => {
    await runtimeActivity?.dispose();
    await client?.close();
    hostSocket?.disconnect();
    if (server && server.exitCode === null) {
        server.kill('SIGTERM');
        await waitFor(() => server.exitCode !== null, 10_000);
    }
    vi.unstubAllEnvs();
    if (baseDir) await rm(baseDir, { recursive: true, force: true });
});

it('shares frozen context, redeems as recipient, provisions through CLI, and returns a labelled mock reply', async () => {
    const published = await json<{ inviteToken: string }>(fixture.ownerToken, '/v1/shared-session-entries', { sourceSessionId: fixture.sourceSessionId, machineId: fixture.machineId, title: '[MOCK] 手机共享闭环' });
    const preview = await json<{ preview: { title: string } }>(null, '/v1/shared-session-entries/preview', { inviteToken: published.inviteToken });
    expect(preview.preview.title).toBe('[MOCK] 手机共享闭环');
    const redeemed = await json<{ access: { status: string } }>(fixture.recipientToken, '/v1/shared-session-entries/redeem', { inviteToken: published.inviteToken });
    expect(redeemed.access.status).toBe('pending');
    const { pollSharedSessionEntry } = await import('./sharedSessionEntryWorker');
    const { readCredentials } = await import('@/persistence');
    const credentials = (await readCredentials())!;
    await pollSharedSessionEntry({ credentials, machineId: fixture.machineId, isOnline: () => hostSocket.connected,
        directTransport: { spawn: async request => {
            expect(request.directory).toBe(fixture.projectDir);
            expect(request.backendTarget).toEqual({ kind: 'builtInAgent', agentId: 'codex' });
            // Process launch boundary only: no Codex executable or model is invoked.
            return { success: true, sessionId: request.existingSessionId };
        } },
    });
    const access = await json<{ access: { status: string; sessionId: string } }>(fixture.recipientToken, `/v1/sessions/${(await json<{ access: { sessionId: string } }>(fixture.recipientToken, '/v1/shared-session-entries/preview', { inviteToken: published.inviteToken })).access.sessionId}/shared-session-entry-access`);
    expect(access.access.status).toBe('ready');
    console.log('COMBO synthetic flow: published, redeemed and CLI provisioned.');
    const sessionId = access.access.sessionId;
    expect((await request(fixture.outsiderToken, `/v1/sessions/${sessionId}/messages`)).status).toBe(404);
    const { fetchSessionByIdCompat } = await import('@/session/transport/http/sessionsHttp');
    const raw = await fetchSessionByIdCompat({ token: fixture.ownerToken, sessionId });
    if (!raw) throw new Error('Provisioned synthetic session was not readable by its owner');
    const { ApiSessionClient } = await import('@/api/session/sessionClient');
    const evaluate = vi.fn(async () => ({ riskProbability: 0 }));
    const { createSessionRuntimeActivity } = await import('@/session/runtimeActivity/createSessionRuntimeActivity');
    runtimeActivity = createSessionRuntimeActivity('supported');
    client = new ApiSessionClient(fixture.ownerToken, { ...raw, metadata: JSON.parse(raw.metadata), encryptionMode: 'plain' } as any, { executionRunContributionHandle: runtimeActivity.executionRunsContributionHandle }, undefined,
        { providerId: 'TEST_ONLY_MOCK', threshold: 0.6, timeoutMs: 1000, evaluate });
    await runtimeActivity.bindPublisher(client.getRuntimeActivitySnapshotPublisher());
    const accepted = client.bindProviderInputOutcomeProducer({ providerId: 'codex', mode: 'unifiedTerminal', matchesCurrentSession: () => true });
    let executions = 0;
    let replied = false;
    client.onUserMessage(async (message) => {
        executions += 1;
        accepted({ kind: 'accepted', localId: message.localId! });
        await client!.sendCodexMessageCommitted({ type: 'message', message: `[MOCK_PROVIDER / no model call] 收到：${message.content.text}` }, { localId: 'synthetic-mock-reply' });
        replied = true;
    });
    try {
        await waitFor(() => (client as any).sessionSyncPendingInputServerContract?.pendingInput === 'v1', 10_000);
    } catch (error) {
        console.log('Synthetic readiness diagnostics', { connected: (client as any).socket?.connected, contract: (client as any).sessionSyncPendingInputServerContract?.mode, pendingInput: (client as any).sessionSyncPendingInputServerContract?.pendingInput, features: await (await request(fixture.ownerToken, '/v1/features')).json() });
        throw error;
    }
    await json(fixture.recipientToken, `/v2/sessions/${sessionId}/pending`, { localId: 'synthetic-mobile-message', content: { t: 'plain', v: { role: 'user', content: { type: 'text', text: '妈妈的合成消息：安排周末。' } } }, requestedAction: { v: 1, kind: 'enqueue' } });
    const result = await client.materializeNextPendingMessageSafely({ reconcileWhenEmpty: 'force' });
    expect(result.type).toBe('materialized');
    await waitFor(() => replied);
    await client.flush();
    const messages = await json(fixture.recipientToken, `/v1/sessions/${sessionId}/messages`);
    const serialized = JSON.stringify(messages);
    expect(serialized).toContain('合成上下文');
    expect(serialized).toContain('MOCK_PROVIDER / no model call');
    expect(serialized).toContain('妈妈的合成消息');
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(executions).toBe(1);
    const again = await client.materializeNextPendingMessageSafely({ reconcileWhenEmpty: 'force' });
    expect(again.type).toBe('no_pending');
    expect(executions).toBe(1);
    console.log('COMBO synthetic paired flow passed: publish -> preview -> redeem -> CLI provision -> recipient send -> mock reply; outsider denied; no real model or user files.');
}, 60_000);
