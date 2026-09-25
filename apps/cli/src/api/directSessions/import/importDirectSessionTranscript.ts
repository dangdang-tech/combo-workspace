import { createHash } from 'node:crypto';

import type { SessionStoredMessageContent } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import type { RawSessionRecord } from '@/session/transport/http/sessionsHttp';
import { commitSessionStoredMessage } from '@/session/transport/http/sessionsHttp';
import {
  encryptStoredSessionPayload,
  resolveSessionEncryptionContextFromCredentials,
  resolveSessionStoredContentEncryptionMode,
} from '@/session/transport/encryption/sessionEncryptionContext';
import type { LoadedLinkedDirectSession } from '@/api/directSessions/takeover/loadLinkedDirectSession';
import type { DirectTranscriptRawMessageV1 } from '@happier-dev/protocol';
import { getDirectSessionProviderOps } from '@/backends/catalog';
import { DirectSessionsProviderUnavailableError } from '@/backends/directSessions/providerOps';
import { adoptDirectSessionMediaForImport } from './adoptDirectSessionMediaForImport';
import {
  loadDirectSessionTranscriptItems,
  type DirectTranscriptImportPage,
} from './loadDirectSessionTranscriptItems';

function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

function resolvePageMaxBytes(): number {
  const raw = Number.parseInt(String(process.env.HAPPIER_DIRECT_SESSIONS_PAGE_MAX_BYTES ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 512_000;
  return Math.max(1024, Math.min(10 * 1024 * 1024, configured));
}

function resolvePageMaxItems(): number {
  const raw = Number.parseInt(String(process.env.HAPPIER_DIRECT_SESSIONS_PAGE_MAX_ITEMS ?? ''), 10);
  const configured = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 200;
  return Math.max(1, Math.min(5000, configured));
}

function makeImportLocalId(params: Readonly<{
  providerId: string;
  remoteSessionId: string;
  directItemId: string;
}>): string {
  const digest = sha256(`${params.providerId}:${params.remoteSessionId}:${params.directItemId}`).slice(0, 24);
  return `direct-import:v1:${params.providerId}:${digest}`;
}

async function loadDirectTranscriptPage(params: Readonly<{
  linked: LoadedLinkedDirectSession;
  cursor?: string;
  maxBytes: number;
  maxItems: number;
}>): Promise<DirectTranscriptImportPage> {
  const providerOps = await getDirectSessionProviderOps(params.linked.providerId);
  if (!providerOps.pageTranscript) {
    throw new DirectSessionsProviderUnavailableError(
      `Agent '${params.linked.providerId}' does not expose a readable transcript for this source.`,
    );
  }
  return await providerOps.pageTranscript({
    source: params.linked.source,
    remoteSessionId: params.linked.remoteSessionId,
    direction: 'older',
    cursor: params.cursor,
    maxBytes: params.maxBytes,
    maxItems: params.maxItems,
  });
}

async function loadAllDirectTranscriptItems(params: Readonly<{
  linked: LoadedLinkedDirectSession;
}>): Promise<DirectTranscriptRawMessageV1[]> {
  const pageMaxBytes = resolvePageMaxBytes();
  const pageMaxItems = resolvePageMaxItems();
  return await loadDirectSessionTranscriptItems({
    readPage: async (cursor) => await loadDirectTranscriptPage({
      linked: params.linked,
      cursor,
      maxBytes: pageMaxBytes,
      maxItems: pageMaxItems,
    }),
  });
}

function buildStoredMessageContent(params: Readonly<{
  rawSession: RawSessionRecord;
  credentials: Credentials;
  raw: Record<string, unknown>;
}>): SessionStoredMessageContent {
  const mode = resolveSessionStoredContentEncryptionMode(params.rawSession);
  if (mode === 'plain') {
    return { t: 'plain', v: params.raw };
  }

  const ctx = resolveSessionEncryptionContextFromCredentials(params.credentials, params.rawSession);
  return {
    t: 'encrypted',
    c: encryptStoredSessionPayload({
      mode: 'e2ee',
      ctx,
      payload: params.raw,
    }),
  };
}

export async function importDirectSessionTranscript(params: Readonly<{
  linked: LoadedLinkedDirectSession;
  credentials: Credentials;
  sessionId: string;
  workingDirectory?: string;
}>): Promise<Readonly<{ importedCount: number }>> {
  const items = await loadAllDirectTranscriptItems({ linked: params.linked });
  const workingDirectory = typeof params.workingDirectory === 'string' && params.workingDirectory.trim().length > 0
    ? params.workingDirectory.trim()
    : params.linked.sessionPath;

  return await importDirectSessionTranscriptItems({
    items, credentials: params.credentials, sessionId: params.sessionId,
    rawSession: params.linked.rawSession, providerId: params.linked.providerId,
    remoteSessionId: params.linked.remoteSessionId, workingDirectory,
  });
}

/** Commit a captured transcript using the destination session's encryption context. */
export async function importDirectSessionTranscriptItems(params: Readonly<{
  items: readonly DirectTranscriptRawMessageV1[];
  credentials: Credentials;
  sessionId: string;
  rawSession: RawSessionRecord;
  providerId: string;
  remoteSessionId: string;
  workingDirectory?: string | null;
}>): Promise<Readonly<{ importedCount: number }>> {
  let importedCount = 0;
  for (const item of params.items) {
    const raw = await adoptDirectSessionMediaForImport({
      raw: item.raw,
      sessionId: params.sessionId,
      messageLocalId: item.localId ?? item.id,
      workingDirectory: params.workingDirectory ?? null,
    });
    const content = buildStoredMessageContent({
      rawSession: params.rawSession,
      credentials: params.credentials,
      raw,
    });

    await commitSessionStoredMessage({
      token: params.credentials.token,
      sessionId: params.sessionId,
      content,
      messageRole: item.messageRole ?? undefined,
      localId: makeImportLocalId({
        providerId: params.providerId,
        remoteSessionId: params.remoteSessionId,
        directItemId: item.id,
      }),
    });
    importedCount += 1;
  }

  return { importedCount };
}
