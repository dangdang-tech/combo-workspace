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

/** One publication owner for CLI and MCP. Only server-committed text is part of the frozen snapshot. */
export async function publishSession(params: Readonly<{
  credentials: Credentials;
  source: PublishSessionSource;
  title: string;
  description?: string;
  publisherDisplayName?: string;
  machineId?: string;
}>): Promise<PublishSessionResult> {
  const title = z.string().trim().min(1).max(120).parse(params.title);
  const publicMetadata = z.object({
    v: z.literal(1), description: z.string().trim().max(1000).optional(),
    publisherDisplayName: z.string().trim().max(80).optional(),
  }).parse({ v: 1, description: params.description, publisherDisplayName: params.publisherDisplayName });
  // Capture the selected endpoint once. Every mutation below uses these same credentials and server.
  const serverUrl = resolveServerHttpBaseUrl();
  const headers = { Authorization: `Bearer ${params.credentials.token}`, 'Content-Type': 'application/json' };
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
    machineId = (await readSettings()).machineId?.trim() ?? '';
    if (!machineId || (params.machineId && params.machineId !== machineId)) throw new Error('Native publication requires this registered host machine');
    const threadId = params.source.threadId.trim();
    if (!threadId || !isAbsolute(params.source.codexHome)) throw new Error('An exact native thread ID and absolute Codex home are required');
    const codexHome = await realpath(params.source.codexHome);
    // Account scope is provided by the canonical create-or-load endpoint. This tag never aliases A's direct/managed session.
    const tag = `publish:codex:v1:${createHash('sha256').update(JSON.stringify([machineId, codexHome, threadId])).digest('hex')}`;
    const existing = await findExistingSessionIdByTag({ credentials: params.credentials, tag });
    if (existing) {
      const published = await existingPublication(existing.sessionId, machineId);
      if (published) return published;
    }
    const captured = await readCodexSessionForPublishing({ threadId, codexHome });
    const created = await getOrCreateSessionByTag({
      credentials: params.credentials, tag,
      metadata: {
        tag, machineId, path: captured.directory, flavor: 'codex', codexBackendMode: 'appServer',
        name: title, summary: { text: title, updatedAt: Date.now() },
        externalHistoryImportV1: { v: 1, providerId: 'codex', remoteSessionId: threadId },
      },
      agentState: null,
    });
    rawSession = created.session;
    // Atomic get-or-create also handles a retry beyond the list scan window or a concurrent publisher.
    const published = await existingPublication(rawSession.id, machineId);
    if (published) return published;
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
