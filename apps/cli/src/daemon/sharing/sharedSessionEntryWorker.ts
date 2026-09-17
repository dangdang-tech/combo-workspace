import type { Credentials } from '@/persistence';
import type { DirectSpawnedSessionTransport } from '@/session/services/createSpawnedSession';
import axios from 'axios';
import { z } from 'zod';
import { configuration } from '@/configuration';
import { provisionSharedSession } from './provisionSharedSession';
import { startSingleFlightIntervalLoop, type SingleFlightIntervalLoopHandle } from '@/daemon/lifecycle/singleFlightIntervalLoop';
import { resolveCliFeatureDecisionForServer } from '@/features/featureDecisionService';
import { logger } from '@/ui/logger';

export type SharedSessionEntryWorkerParams = Readonly<{
  credentials: Credentials;
  machineId: string;
  directTransport: DirectSpawnedSessionTransport;
  isOnline: () => boolean;
}>;

export function startSharedSessionEntryWorker(params: SharedSessionEntryWorkerParams): SingleFlightIntervalLoopHandle {
  let paused = false;
  let stopped = false;
  const isOnline = () => !paused && !stopped && params.isOnline();
  const loop = startSingleFlightIntervalLoop({
    intervalMs: 3_000, failureBackoffMs: 3_000, maxFailureBackoffMs: 30_000, unref: true,
    task: async () => {
      if (!isOnline()) return;
      const { decision } = await resolveCliFeatureDecisionForServer({
        featureId: 'sharing.sessionEntries', env: process.env, serverUrl: configuration.apiServerUrl, timeoutMs: 5_000,
      });
      if (decision.state !== 'enabled' || !isOnline()) return;
      await pollSharedSessionEntry({ ...params, isOnline });
    },
    onError: () => logger.debug('[DAEMON] Shared session preparation deferred after transport or runtime failure'),
  });
  return {
    stop: () => { stopped = true; loop.stop(); },
    trigger: () => loop.trigger(),
    pause: () => { paused = true; loop.pause(); },
    resume: () => { if (stopped) return; paused = false; loop.resume(); loop.trigger(); },
  };
}

const ClaimResponseSchema = z.object({ assignment: z.object({
  entryId: z.string().min(1), memberId: z.string().min(1), sourceSessionId: z.string().min(1),
  sourceSnapshot: z.unknown().optional(),
  sessionId: z.string().min(1).nullable(), encryptionMode: z.enum(['plain', 'e2ee']),
  recipient: z.object({ userId: z.string().min(1), signingPublicKey: z.string().nullable(),
    contentPublicKeyB64: z.string().nullable(), contentPublicKeySigB64: z.string().nullable() }),
}).nullable() });

const deterministicErrors = new Set([
  'encryption_upgrade_required', 'recipient_key_invalid', 'source_session_invalid',
  'context_snapshot_required', 'context_snapshot_too_large', 'context_snapshot_unavailable',
  'child_session_invalid', 'session_encryption_mismatch', 'session_key_unavailable',
]);

export async function pollSharedSessionEntry(params: SharedSessionEntryWorkerParams): Promise<void> {
  if (!params.isOnline()) return;
  const baseUrl = `${configuration.apiServerUrl}/v1/machines/${encodeURIComponent(params.machineId)}/shared-session-entries`;
  const config = { headers: { Authorization: `Bearer ${params.credentials.token}` }, timeout: 15_000 };
  const claim = await axios.post(`${baseUrl}/claim`, {}, config);
  const { assignment } = ClaimResponseSchema.parse(claim.data);
  if (!assignment || !params.isOnline()) return;
  let completed: Awaited<ReturnType<typeof provisionSharedSession>>;
  try {
    completed = await provisionSharedSession({ ...params, assignment });
  } catch (error) {
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? error.code : null;
    if (code === 'host_offline' || !params.isOnline()) return;
    if (!code || !deterministicErrors.has(code)) throw error;
    await axios.post(`${baseUrl}/${encodeURIComponent(assignment.memberId)}/fail`, { errorCode: code }, config);
    return;
  }
  if (!params.isOnline()) return;
  // Keep ambiguous network failures retryable: the server member and daemon spawn nonce
  // retain the same allocation identity, and no user task is ever queued by this worker.
  await axios.post(`${baseUrl}/${encodeURIComponent(assignment.memberId)}/complete`, completed, config);
}
