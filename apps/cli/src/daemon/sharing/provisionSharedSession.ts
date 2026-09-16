import type { Credentials } from '@/persistence';
import tweetnacl from 'tweetnacl';
import { resolveAgentIdFromSessionMetadata } from '@happier-dev/agents';
import { sealEncryptedDataKeyEnvelopeV1 } from '@happier-dev/protocol';
import { decodeBase64, encodeBase64, getRandomBytes } from '@/api/encryption';
import { openSessionDataEncryptionKey } from '@/api/client/openSessionDataEncryptionKey';
import { createSpawnedSession, type DirectSpawnedSessionTransport } from '@/session/services/createSpawnedSession';
import { fetchSessionByIdCompat } from '@/session/transport/http/sessionsHttp';
import { tryDecryptSessionMetadata } from '@/session/transport/encryption/sessionEncryptionContext';
import { updateSessionMetadataWithRetry } from '@/session/metadata/updateSessionMetadataWithRetry';
import { normalizeSpawnSessionDirectory } from '@/rpc/handlers/spawnSessionOptionsContract';
import { resolveSessionCreateEncryptionMode } from '@/api/session/resolveSessionCreateEncryptionMode';
import { resolveServerHttpBaseUrl } from '@/api/client/serverHttpBaseUrl';
import { configuration } from '@/configuration';

export type SharedSessionAssignment = Readonly<{
  entryId: string;
  memberId: string;
  sourceSessionId: string;
  sessionId: string | null;
  encryptionMode: 'plain' | 'e2ee';
  recipient: Readonly<{
    userId: string;
    signingPublicKey: string | null;
    contentPublicKeyB64: string | null;
    contentPublicKeySigB64: string | null;
  }>;
}>;

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
}>): Promise<{ sessionId: string; encryptedDataKey?: string }> {
  const { assignment, credentials } = params;
  const assertOnline = () => { if (!params.isOnline()) fail('host_offline'); };
  assertOnline();
  if (assignment.encryptionMode === 'e2ee' && credentials.encryption.type !== 'dataKey') {
    fail('encryption_upgrade_required');
  }
  const recipientKey = assignment.encryptionMode === 'e2ee' ? verifiedRecipientKey(assignment.recipient) : null;
  const source = await fetchSessionByIdCompat({ token: credentials.token, sessionId: assignment.sourceSessionId });
  if (!source) fail('source_session_invalid');
  if ((source.encryptionMode ?? 'e2ee') !== assignment.encryptionMode) fail('session_encryption_mismatch');
  const sourceMetadata = tryDecryptSessionMetadata({ credentials, rawSession: source });
  if (!sourceMetadata || sourceMetadata.machineId !== params.machineId
    || typeof sourceMetadata.path !== 'string' || !sourceMetadata.path.trim()) fail('source_session_invalid');
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
  const sessionId = assignment.sessionId ?? (await createSpawnedSession({
    credentials, directory, machineId: params.machineId,
    backendTarget: { kind: 'builtInAgent', agentId },
    spawnNonce: `shared-entry:${assignment.memberId}`,
    transcriptStorage: 'persisted',
    approvedNewDirectoryCreation: false,
    directTransport: params.directTransport,
  })).sessionId;
  if (sessionId === assignment.sourceSessionId) fail('child_session_invalid');
  const child = await fetchSessionByIdCompat({ token: credentials.token, sessionId });
  if (!child) fail('child_session_invalid');
  if ((child.encryptionMode ?? 'e2ee') !== assignment.encryptionMode) fail('session_encryption_mismatch');
  const childMetadata = tryDecryptSessionMetadata({ credentials, rawSession: child });
  if (!childMetadata || childMetadata.machineId !== params.machineId
    || typeof childMetadata.path !== 'string'
    || normalizeSpawnSessionDirectory(childMetadata.path, process.env) !== directory) fail('child_session_invalid');
  if (typeof childMetadata.sharedSessionEntryId === 'string'
    && childMetadata.sharedSessionEntryId !== assignment.entryId) fail('child_session_invalid');
  await updateSessionMetadataWithRetry({ credentials, token: credentials.token, sessionId, rawSession: child,
    updater: (metadata) => ({ ...metadata, sharedSessionEntryId: assignment.entryId }),
  });
  assertOnline();
  if (!recipientKey) return { sessionId };
  // Fail closed when a genuine per-session DEK cannot be opened. Never use the account/machine fallback.
  const dataKey = openSessionDataEncryptionKey({ credential: credentials, encryptedDataEncryptionKeyBase64: child.dataEncryptionKey });
  if (!dataKey || dataKey.length !== 32) fail('session_key_unavailable');
  return { sessionId, encryptedDataKey: encodeBase64(sealEncryptedDataKeyEnvelopeV1({
    dataKey, recipientPublicKey: recipientKey, randomBytes: getRandomBytes,
  })) };
}
