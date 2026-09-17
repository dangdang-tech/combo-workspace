import type { Credentials } from '@/persistence';
import { z } from 'zod';
import tweetnacl from 'tweetnacl';
import { resolveAgentIdFromSessionMetadata, type HappierReplayDialogItem } from '@happier-dev/agents';
import { sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { decodeBase64, encodeBase64, getRandomBytes } from '@/api/encryption';
import { openSessionDataEncryptionKey } from '@/api/client/openSessionDataEncryptionKey';
import { createSpawnedSession, type DirectSpawnedSessionTransport } from '@/session/services/createSpawnedSession';
import { commitSessionStoredMessage, fetchSessionByIdCompat } from '@/session/transport/http/sessionsHttp';
import { encryptSessionPayload, resolveSessionEncryptionContextFromCredentials, tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';
import { updateSessionMetadataWithRetry } from '@/session/metadata/updateSessionMetadataWithRetry';
import { normalizeSpawnSessionDirectory } from '@/rpc/handlers/spawnSessionOptionsContract';
import { resolveSessionCreateEncryptionMode } from '@/api/session/resolveSessionCreateEncryptionMode';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { buildReplaySeededSpawnRecipe } from '@/session/replay/buildReplaySeededSpawnRecipe';
import { resolveForkInheritedOverridesFromMetadata } from '@/session/fork/resolveForkInheritedOverridesFromMetadata';
import { createConnectedServiceForkLaunchContext } from '@/session/fork/connectedServiceForkLaunchContext';
import { configuration } from '@/configuration';

export type SharedSessionAssignment = Readonly<{
  entryId: string;
  memberId: string;
  sourceSessionId: string;
  sourceSnapshot?: unknown;
  sessionId: string | null;
  encryptionMode: 'plain' | 'e2ee';
  recipient: Readonly<{
    userId: string;
    signingPublicKey: string | null;
    contentPublicKeyB64: string | null;
    contentPublicKeySigB64: string | null;
  }>;
}>;

const SourceSnapshotSchema = z.object({
  v: z.literal(1),
  session: z.object({ id: z.string().min(1), seq: z.number().int().nonnegative(), metadata: z.string(),
    encryptionMode: z.enum(['plain', 'e2ee']), dataEncryptionKey: z.string().nullable() }),
  messages: z.array(z.object({ seq: z.number().int().nonnegative(), createdAt: z.number(), content: z.unknown(), messageRole: z.string().nullable().optional() })).max(5_000),
});

function fail(code: string): never {
  throw Object.assign(new Error(code), { code });
}

function verifiedRecipientKey(recipient: SharedSessionAssignment['recipient']): Uint8Array {
  try {
    if (!recipient.signingPublicKey || !/^[0-9a-f]{64}$/i.test(recipient.signingPublicKey)
      || !recipient.contentPublicKeyB64 || !recipient.contentPublicKeySigB64) fail('recipient_key_invalid');
    const key = decodeBase64(recipient.contentPublicKeyB64);
    const signature = decodeBase64(recipient.contentPublicKeySigB64);
    const binding = new Uint8Array([...new TextEncoder().encode('Happy content key v1\u0000'), ...key]);
    if (key.length !== 32 || signature.length !== tweetnacl.sign.signatureLength
      || !tweetnacl.sign.detached.verify(binding, signature, new Uint8Array(Buffer.from(recipient.signingPublicKey, 'hex')))) {
      fail('recipient_key_invalid');
    }
    return key;
  } catch {
    return fail('recipient_key_invalid');
  }
}

export async function provisionSharedSession(params: Readonly<{
  credentials: Credentials;
  machineId: string;
  assignment: SharedSessionAssignment;
  directTransport: DirectSpawnedSessionTransport;
  isOnline: () => boolean;
}>): Promise<{ sessionId: string; encryptedDataKey?: string; contextSnapshotVersion: 1 }> {
  const { assignment, credentials } = params;
  const assertOnline = () => { if (!params.isOnline()) fail('host_offline'); };
  assertOnline();
  if (assignment.encryptionMode === 'e2ee' && credentials.encryption.type !== 'dataKey') {
    fail('encryption_upgrade_required');
  }
  const recipientKey = assignment.encryptionMode === 'e2ee' ? verifiedRecipientKey(assignment.recipient) : null;
  // A durable member allocation is already the context boundary. Re-enable only
  // restores that child's grant, including legacy entries with no saved source.
  if (assignment.sessionId) {
    return await finalizeSharedSession({ params, sessionId: assignment.sessionId, recipientKey, contextDialog: [] });
  }
  const snapshotResult = SourceSnapshotSchema.safeParse(assignment.sourceSnapshot);
  if (!snapshotResult.success) fail('context_snapshot_required');
  const sourceSnapshot = snapshotResult.data;
  const source = sourceSnapshot.session;
  if (source.id !== assignment.sourceSessionId || sourceSnapshot.messages.some(message => message.seq > source.seq)) fail('source_session_invalid');
  if (source.encryptionMode !== assignment.encryptionMode) fail('session_encryption_mismatch');
  const sourceMetadata = tryDecryptSessionMetadata({ credentials, rawSession: source });
  if (!sourceMetadata || sourceMetadata.machineId !== params.machineId
    || typeof sourceMetadata.path !== 'string' || !sourceMetadata.path.trim()) fail('source_session_invalid');
  // An ancestor is not part of this immutable snapshot. Never read it live later.
  if (sourceMetadata.forkV1) fail('context_snapshot_unavailable');
  const agentId = resolveAgentIdFromSessionMetadata(sourceMetadata);
  if (!agentId) fail('source_session_invalid');
  const directory = normalizeSpawnSessionDirectory(sourceMetadata.path, process.env);
  assertOnline();
  if (!assignment.sessionId) {
    // The canonical runner creates sessions using current account/server policy. Until it
    // supports a per-session mode, refuse drift before spawning an orphan or downgrading.
    const creationPolicy = await resolveSessionCreateEncryptionMode({
      token: credentials.token,
      serverBaseUrl: resolveServerHttpBaseUrl(),
      featuresTimeoutMs: configuration.sessionControlHttpTimeoutMs,
      accountTimeoutMs: configuration.sessionControlHttpTimeoutMs,
    });
    if (creationPolicy.desiredSessionEncryptionMode !== assignment.encryptionMode) fail('session_encryption_mismatch');
  }
  assertOnline();
  const inherited = resolveForkInheritedOverridesFromMetadata(sourceMetadata, agentId);
  const recipe = !assignment.sessionId ? await buildReplaySeededSpawnRecipe({
    credentials, cwd: directory,
    source: { sourceSessionId: assignment.sourceSessionId, forkPoint: { type: 'seq', upToSeqInclusive: source.seq } },
    sourceSnapshot, providerHintAgentId: agentId, strategy: 'recent_messages',
    requestId: `shared-entry:${assignment.memberId}`,
    extraMetadata: { ...inherited.metadata, machineId: params.machineId, sharedSessionEntryId: assignment.entryId },
  }) : null;
  if (recipe && !recipe.ok) fail(recipe.snapshotError ?? 'context_snapshot_unavailable');
  assertOnline();
  const sessionId = assignment.sessionId ?? (await createSpawnedSession({
    credentials, directory, machineId: params.machineId,
    backendTarget: { kind: 'builtInAgent', agentId }, ...inherited.spawn,
    spawnNonce: `shared-entry:${assignment.memberId}`,
    transcriptStorage: 'persisted', approvedNewDirectoryCreation: false,
    ...(recipe?.ok ? { replaySeededCreation: {
      tag: `shared-entry:${assignment.memberId}`, agentId, metadata: recipe.recipe.metadata,
      sourceRecipe: { sourceSessionId: assignment.sourceSessionId, cutoffSeqInclusive: source.seq },
    } } : {}),
    connectedServiceChildLaunch: createConnectedServiceForkLaunchContext({ inherited }),
    directTransport: params.directTransport,
  })).sessionId;
  return await finalizeSharedSession({ params, sessionId, expectedDirectory: directory, recipientKey,
    contextDialog: recipe?.ok ? recipe.recipe.dialog : [] });
}

/** One child validation/key-grant owner for fresh allocation and restored membership. */
async function finalizeSharedSession(input: Readonly<{
  params: Parameters<typeof provisionSharedSession>[0];
  sessionId: string;
  expectedDirectory?: string;
  recipientKey: Uint8Array | null;
  contextDialog: readonly HappierReplayDialogItem[];
}>): Promise<{ sessionId: string; encryptedDataKey?: string; contextSnapshotVersion: 1 }> {
  const { params, sessionId, expectedDirectory, recipientKey, contextDialog } = input;
  const { assignment, credentials } = params;
  const assertOnline = () => { if (!params.isOnline()) fail('host_offline'); };
  assertOnline();
  if (sessionId === assignment.sourceSessionId) fail('child_session_invalid');
  const child = await fetchSessionByIdCompat({ token: credentials.token, sessionId });
  if (!child || child.share) fail('child_session_invalid');
  if ((child.encryptionMode ?? 'e2ee') !== assignment.encryptionMode) fail('session_encryption_mismatch');
  const childMetadata = tryDecryptSessionMetadata({ credentials, rawSession: child });
  if (!childMetadata || childMetadata.machineId !== params.machineId
    || typeof childMetadata.path !== 'string' || !childMetadata.path.trim()
    || (expectedDirectory !== undefined && normalizeSpawnSessionDirectory(childMetadata.path, process.env) !== expectedDirectory)) fail('child_session_invalid');
  if (expectedDirectory === undefined && childMetadata.sharedSessionEntryId !== assignment.entryId) fail('child_session_invalid');
  if (typeof childMetadata.sharedSessionEntryId === 'string'
    && childMetadata.sharedSessionEntryId !== assignment.entryId) fail('child_session_invalid');
  // Validate the actual child key before importing any history under it.
  const dataKey = assignment.encryptionMode === 'e2ee'
    ? openSessionDataEncryptionKey({ credential: credentials, encryptedDataEncryptionKeyBase64: child.dataEncryptionKey }) : null;
  if (assignment.encryptionMode === 'e2ee' && (!dataKey || dataKey.length !== 32)) fail('session_key_unavailable');
  await updateSessionMetadataWithRetry({ credentials, token: credentials.token, sessionId, rawSession: child,
    updater: (metadata) => ({ ...metadata, sharedSessionEntryId: assignment.entryId }),
  });
  assertOnline();
  if (contextDialog.length > 0) {
    const ctx = resolveSessionEncryptionContextFromCredentials(credentials, child);
    for (const [index, item] of contextDialog.entries()) {
      assertOnline();
      const localId = `shared-entry:${assignment.memberId}:context:${index}`;
      const role = item.role === 'User' ? 'user' : 'agent';
      const content = role === 'user' ? { type: 'text', text: item.text } : {
        type: 'output', data: { type: 'assistant', uuid: localId,
          message: { role: 'assistant', content: item.text } },
      };
      const payload = { role, content, meta: { source: 'cli', sentFrom: 'cli' } };
      await commitSessionStoredMessage({ token: credentials.token, sessionId, localId, messageRole: role,
        content: assignment.encryptionMode === 'plain' ? { t: 'plain', v: payload }
          : { t: 'encrypted', c: encryptSessionPayload({ ctx, payload, idempotencyKey: localId }) },
      });
    }
  }
  assertOnline();
  if (!recipientKey) return { sessionId, contextSnapshotVersion: 1 };
  return { sessionId, contextSnapshotVersion: 1, encryptedDataKey: encodeBase64(sealEncryptedDataKeyEnvelopeV1({
    dataKey: dataKey!, recipientPublicKey: recipientKey, randomBytes: getRandomBytes,
  })) };
}
