import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import axios from 'axios';
import { z } from 'zod';

import { configuration } from '@/configuration';
import { readSettings, type Credentials } from '@/persistence';
import { createHttpStatusError } from '@/api/client/httpStatusError';
import { findExistingSessionIdByTag } from '@/api/directSessions/linking/ensureDirectSessionLink';
import { importDirectSessionTranscriptItems } from '@/api/directSessions/import/importDirectSessionTranscript';
import { readCodexSessionForPublishing } from '@/backends/codex/directSessions/readCodexSessionForPublishing';
import { fetchSessionById, getOrCreateSessionByTag, type RawSessionRecord } from '@/session/transport/http/sessionsHttp';
import { resolveServerHttpBaseUrl } from '@/session/transport/http/serverHttpBaseUrl';
import { buildReplaySeededSpawnRecipe } from '@/session/replay/buildReplaySeededSpawnRecipe';
import { tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';

export type PublishSessionSource = Readonly<{ kind: 'session'; sessionId: string }> | Readonly<{ kind: 'codex'; threadId: string; codexHome: string }>;
export type PublishSessionResult = Readonly<{ sourceSessionId: string; entryId: string; inviteUrl: string }>;

const entrySchema = z.object({
  id: z.string().min(1), sourceSessionId: z.string().min(1), machineId: z.string().min(1),
  createdAt: z.number(), hasContextSnapshot: z.boolean().optional(), hasReusableInvite: z.boolean().optional(),
});
const tokenSchema = z.object({ inviteToken: z.string().min(1) });
const basePath = '/v1/shared-session-entries';

function result(sourceSessionId: string, entryId: string, inviteToken: string): PublishSessionResult {
  const web = new URL(configuration.webappUrl);
  const relay = new URL(configuration.publicServerUrl);
  if (!['http:', 'https:'].includes(web.protocol) || !['http:', 'https:'].includes(relay.protocol)) {
    throw new Error('Publish requires configured HTTP(S) web and public server URLs');
  }
  return {
    sourceSessionId, entryId,
    inviteUrl: `${web.href.replace(/\/+$/, '')}/invite/${encodeURIComponent(inviteToken)}?server=${encodeURIComponent(relay.href.replace(/\/+$/, ''))}`,
  };
}

function publicationTransport(credentials: Credentials) {
  // Capture the selected endpoint once. Every mutation below uses these same credentials and server.
  const serverUrl = resolveServerHttpBaseUrl();
  const headers = { Authorization: `Bearer ${credentials.token}`, 'Content-Type': 'application/json' };
  async function request(path: string, body?: unknown): Promise<unknown> {
    const options = { headers, timeout: configuration.sessionControlHttpTimeoutMs, validateStatus: () => true };
    const response = body === undefined
      ? await axios.get(`${serverUrl}${path}`, options)
      : await axios.post(`${serverUrl}${path}`, body, options);
    if (response.status < 200 || response.status >= 300) {
      const code = typeof response.data?.error === 'string' ? response.data.error : 'publish_failed';
      throw createHttpStatusError(response.status, code, code);
    }
    return response.data;
  }
  async function existingPublication(sessionId: string, machineId: string): Promise<PublishSessionResult | null> {
    const entries = z.object({ entries: z.array(entrySchema) }).parse(await request(basePath)).entries;
    const reusable = entries.filter((entry) => entry.sourceSessionId === sessionId && entry.machineId === machineId
      && entry.hasContextSnapshot === true && entry.hasReusableInvite === true)
      .sort((left, right) => right.createdAt - left.createdAt)[0];
    if (!reusable) return null;
    const { inviteToken } = tokenSchema.parse(await request(`${basePath}/${encodeURIComponent(reusable.id)}/invite`));
    return result(sessionId, reusable.id, inviteToken);
  }

  return { request, existingPublication };
}

type NativeTarget = Readonly<{ machineId: string; threadId: string; codexHome: string; tag: string }>;

async function resolveNativeTarget(params: Readonly<{
  source: Extract<PublishSessionSource, { kind: 'codex' }>;
  machineId?: string;
}>): Promise<NativeTarget> {
  const machineId = (await readSettings()).machineId?.trim() ?? '';
  if (!machineId || (params.machineId && params.machineId !== machineId)) throw new Error('Native publication requires this registered host machine');
  const threadId = params.source.threadId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(threadId) || !isAbsolute(params.source.codexHome)) {
    throw new Error('An exact native thread ID and absolute Codex home are required');
  }
  const codexHome = await realpath(params.source.codexHome);
  const tag = 'publish:codex:v1:' + createHash('sha256').update(JSON.stringify([machineId, codexHome, threadId])).digest('hex');
  return { machineId, threadId, codexHome, tag };
}

function captureFingerprint(target: NativeTarget, captured: Awaited<ReturnType<typeof readCodexSessionForPublishing>>): string {
  return createHash('sha256').update(JSON.stringify({ machineId: target.machineId, codexHome: target.codexHome, threadId: target.threadId, ...captured })).digest('hex');
}

async function readNativeCapture(target: NativeTarget) {
  try {
    return await readCodexSessionForPublishing(target);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'context_snapshot_too_large') throw error;
    throw Object.assign(new Error('Native text cannot be captured completely; wait for Codex to finish writing and try again'), { code: 'context_snapshot_unavailable' });
  }
}

async function assertCapturedReplayFits(params: Readonly<{
  target: NativeTarget;
  captured: Awaited<ReturnType<typeof readCodexSessionForPublishing>>;
  credentials: Credentials;
  title?: string;
}>): Promise<void> {
  // A local plain snapshot lets the canonical consumer validate the same text before any
  // server mutation. The stable tag is longer than the eventual source ID, reserving its framing.
  const { captured, target } = params;
  const recipe = await buildReplaySeededSpawnRecipe({
    credentials: params.credentials, cwd: captured.directory,
    source: { sourceSessionId: target.tag, forkPoint: { type: 'seq', upToSeqInclusive: captured.items.length } },
    sourceSnapshot: {
      session: { id: target.tag, seq: captured.items.length, encryptionMode: 'plain', dataEncryptionKey: null,
        metadata: JSON.stringify({ ...(params.title ? { summary: { text: params.title } } : {}) }) },
      messages: captured.items.map((item, index) => ({ seq: index + 1, createdAt: item.createdAtMs,
        messageRole: item.messageRole, content: { t: 'plain', v: item.raw } })),
    },
    providerHintAgentId: 'codex', strategy: 'recent_messages',
  });
  if (!recipe.ok) {
    throw Object.assign(new Error(recipe.errorMessage), { code: recipe.snapshotError ?? 'context_snapshot_unavailable' });
  }
}

function assertImportedSnapshot(rawSession: RawSessionRecord, credentials: Credentials, fingerprint: string): void {
  const metadata = tryDecryptSessionMetadata({ credentials, rawSession });
  const imported = metadata?.externalHistoryImportV1 as { snapshotFingerprint?: unknown } | undefined;
  // A partially imported source is immutable too: retrying may not mix old acknowledged rows with a newer capture.
  if (imported?.snapshotFingerprint !== fingerprint) {
    throw Object.assign(new Error('The unfinished publication belongs to a different text capture'), { code: 'publication_capture_conflict' });
  }
}

export async function previewNativeSessionPublication(params: Readonly<{
  credentials: Credentials;
  source: Extract<PublishSessionSource, { kind: 'codex' }>;
  machineId?: string;
}>): Promise<
  | { status: 'already_published'; publication: PublishSessionResult }
  | { status: 'ready'; snapshotFingerprint: string; directory: string; messages: Array<{ role: 'user' | 'assistant'; text: string }> }
> {
  const target = await resolveNativeTarget(params);
  const { existingPublication } = publicationTransport(params.credentials);
  const existing = await findExistingSessionIdByTag({ credentials: params.credentials, tag: target.tag });
  if (existing) {
    const publication = await existingPublication(existing.sessionId, target.machineId);
    if (publication) return { status: 'already_published', publication };
  }
  const captured = await readNativeCapture(target);
  const snapshotFingerprint = captureFingerprint(target, captured);
  if (existing) {
    const rawSession = await fetchSessionById({ token: params.credentials.token, sessionId: existing.sessionId });
    if (!rawSession) throw new Error('Imported source unavailable');
    assertImportedSnapshot(rawSession, params.credentials, snapshotFingerprint);
  }
  await assertCapturedReplayFits({ target, captured, credentials: params.credentials });
  const messages = captured.items.map((item) => {
    const raw = item.raw as { role: string; content: { text?: string; data?: { message?: string } } };
    return { role: (raw.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', text: raw.role === 'user' ? raw.content.text! : raw.content.data!.message! };
  });
  return { status: 'ready', snapshotFingerprint, directory: captured.directory, messages };
}

/** One publication owner for CLI and MCP. Only server-committed text is part of the frozen snapshot. */
export async function publishSession(params: Readonly<{
  credentials: Credentials;
  source: PublishSessionSource;
  title: string;
  description?: string;
  publisherDisplayName?: string;
  machineId?: string;
  expectedSnapshotFingerprint?: string;
}>): Promise<PublishSessionResult> {
  const title = z.string().trim().min(1).max(120).parse(params.title);
  const publicMetadata = z.object({
    v: z.literal(1), description: z.string().trim().max(1000).optional(),
    publisherDisplayName: z.string().trim().max(80).optional(),
  }).parse({ v: 1, description: params.description, publisherDisplayName: params.publisherDisplayName });
  const { request, existingPublication } = publicationTransport(params.credentials);

  let rawSession: RawSessionRecord;
  let machineId: string;
  if (params.source.kind === 'session') {
    const sessionId = params.source.sessionId.trim();
    if (!sessionId || sessionId === 'cli-global') throw new Error('An exact COMBO session ID is required');
    const found = await fetchSessionById({ token: params.credentials.token, sessionId });
    if (!found) throw new Error('Session not found');
    rawSession = found;
    const metadata = tryDecryptSessionMetadata({ credentials: params.credentials, rawSession });
    machineId = typeof metadata?.machineId === 'string' ? metadata.machineId.trim() : '';
    if (!machineId || (params.machineId && params.machineId !== machineId)) throw new Error('Session host machine is unavailable or mismatched');
    if (metadata?.directSessionV1) throw new Error('Direct sessions must be published with an explicit native thread and Codex home so their full text can be imported');
  } else {
    const target = await resolveNativeTarget({ source: params.source, machineId: params.machineId });
    const { threadId, tag } = target;
    machineId = target.machineId;
    const existing = await findExistingSessionIdByTag({ credentials: params.credentials, tag });
    if (existing) {
      const published = await existingPublication(existing.sessionId, machineId);
      if (published) return published;
    }
    const captured = await readNativeCapture(target);
    const snapshotFingerprint = captureFingerprint(target, captured);
    if (existing) {
      const importedSource = await fetchSessionById({ token: params.credentials.token, sessionId: existing.sessionId });
      if (!importedSource) throw new Error('Imported source unavailable');
      assertImportedSnapshot(importedSource, params.credentials, snapshotFingerprint);
    }
    if (params.expectedSnapshotFingerprint !== undefined && params.expectedSnapshotFingerprint !== snapshotFingerprint) {
      throw Object.assign(new Error('Native text changed; preview again before publishing'), { code: 'snapshot_changed' });
    }
    await assertCapturedReplayFits({ target, captured, credentials: params.credentials, title });
    const created = await getOrCreateSessionByTag({
      credentials: params.credentials, tag,
      metadata: {
        tag, machineId, path: captured.directory, flavor: 'codex', codexBackendMode: 'appServer',
        name: title, summary: { text: title, updatedAt: Date.now() },
        externalHistoryImportV1: { v: 1, providerId: 'codex', remoteSessionId: threadId, snapshotFingerprint },
      },
      agentState: null,
    });
    rawSession = created.session;
    // Atomic get-or-create also handles a retry beyond the list scan window or a concurrent publisher.
    const published = await existingPublication(rawSession.id, machineId);
    if (published) return published;
    assertImportedSnapshot(rawSession, params.credentials, snapshotFingerprint);
    await importDirectSessionTranscriptItems({
      credentials: params.credentials, sessionId: rawSession.id, rawSession,
      providerId: 'codex', remoteSessionId: threadId, items: captured.items, workingDirectory: captured.directory,
    });
  }
  const response = z.object({ entry: entrySchema, inviteToken: z.string().min(1) }).parse(await request(basePath, {
    title, sourceSessionId: rawSession.id, machineId, reuseExisting: true,
    ...(params.description !== undefined || params.publisherDisplayName !== undefined ? { publicMetadata } : {}),
  }));
  if (response.entry.sourceSessionId !== rawSession.id || response.entry.machineId !== machineId) {
    throw new Error('Published entry does not match the selected source session and host');
  }
  return result(rawSession.id, response.entry.id, response.inviteToken);
}
