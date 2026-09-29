import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { RPC_METHODS } from '@happier-dev/protocol/rpc';
import {
  DirectSessionPublishPreviewRequestSchema,
  DirectSessionPublishRequestSchema,
  type DirectSessionPublishPreviewRequest,
  type DirectSessionPublishPreviewResponse,
  type DirectSessionPublishResponse,
} from '@happier-dev/protocol';

import type { RpcHandlerRegistrar } from '@/api/rpc/types';
import { INVALID_RESPONSE_SHAPE_CODE, readHttpStatus } from '@/api/client/httpStatusError';
import { logger } from '@/utils/logger';
import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';
import { readCredentials, readSettings } from '@/persistence';
import { previewNativeSessionPublication, publishSession } from '@/session/sharing/publishSession';

type Failure = Extract<DirectSessionPublishResponse, { ok: false }>;
function failure(errorCode: Failure['errorCode'], error = errorCode): Failure {
  return { ok: false, errorCode, error };
}
const diagnosticErrorNames = new Set([
  'Error', 'TypeError', 'RangeError', 'SyntaxError', 'ReferenceError', 'URIError', 'EvalError',
  'AggregateError', 'AxiosError', 'HttpStatusError', 'InvalidResponseShapeError', 'ZodError', 'AbortError',
]);
const diagnosticErrorCodes = new Set([
  'invalid_request', 'not_authenticated', 'snapshot_changed', 'publication_capture_conflict',
  'context_snapshot_too_large', 'context_snapshot_unavailable', 'machine_offline', INVALID_RESPONSE_SHAPE_CODE,
  'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN',
  'ERR_BAD_REQUEST', 'ERR_BAD_RESPONSE', 'ERR_NETWORK', 'ERR_CANCELED',
]);
function publicationFailure(error: unknown, phase: 'preview' | 'publish'): Failure {
  const code = error instanceof Error && 'code' in error ? error.code : null;
  const name = error instanceof Error ? error.name : '';
  const status = readHttpStatus(error);
  // Error fields can contain HTTP bodies, credentials, paths or conversation text. Only fixed
  // classifications and a numeric HTTP status may cross this diagnostic boundary.
  logger.warn('[DIRECT SESSION PUBLICATION] Failed', {
    phase,
    errorName: diagnosticErrorNames.has(name) ? name : 'UnknownError',
    code: typeof code === 'string' && diagnosticErrorCodes.has(code) ? code : null,
    httpStatus: status !== null && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
  });
  switch (code) {
    case 'invalid_request':
    case 'snapshot_changed':
    case 'publication_capture_conflict':
    case 'context_snapshot_too_large':
    case 'context_snapshot_unavailable':
      return failure(code);
    default:
      return failure('internal_error');
  }
}
async function resolvePublicationSource(request: DirectSessionPublishPreviewRequest) {
  const settings = await readSettings();
  if (!settings.machineId || settings.machineId !== request.machineId || request.source.home !== 'user') {
    throw Object.assign(new Error('Publication requires this host and its configured Codex home'), { code: 'invalid_request' });
  }
  const configuredHome = resolveConfiguredCodexHome(process.env);
  const codexHome = await realpath(configuredHome).catch(() => {
    throw Object.assign(new Error('Configured Codex home is unavailable'), { code: 'context_snapshot_unavailable' });
  });
  if (request.source.homePath !== undefined) {
    const requestedHome = request.source.homePath.trim();
    const matched = isAbsolute(requestedHome) && await realpath(requestedHome).catch(() => null) === codexHome;
    if (!matched) throw Object.assign(new Error('Codex home override is not allowed'), { code: 'invalid_request' });
  }
  return { kind: 'codex' as const, threadId: request.remoteSessionId, codexHome };
}

/** Read-only preview and explicit publication share the CLI/MCP publication owner. */
export function registerMachineDirectSessionPublicationRpcHandlers(rpcHandlerManager: RpcHandlerRegistrar): void {
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_PUBLISH_PREVIEW, async (raw: unknown): Promise<DirectSessionPublishPreviewResponse> => {
    const parsed = DirectSessionPublishPreviewRequestSchema.safeParse(raw);
    if (!parsed.success) return failure('invalid_request');
    try {
      const credentials = await readCredentials();
      if (!credentials) return failure('not_authenticated');
      const source = await resolvePublicationSource(parsed.data);
      return { ok: true, ...await previewNativeSessionPublication({ credentials, source, machineId: parsed.data.machineId }) };
    } catch (error) {
      return publicationFailure(error, 'preview');
    }
  });
  rpcHandlerManager.registerHandler(RPC_METHODS.DAEMON_DIRECT_SESSION_PUBLISH, async (raw: unknown): Promise<DirectSessionPublishResponse> => {
    const parsed = DirectSessionPublishRequestSchema.safeParse(raw);
    if (!parsed.success) return failure('invalid_request');
    try {
      const credentials = await readCredentials();
      if (!credentials) return failure('not_authenticated');
      const source = await resolvePublicationSource(parsed.data);
      const publication = await publishSession({ ...parsed.data, credentials, source });
      return { ok: true, publication };
    } catch (error) {
      return publicationFailure(error, 'publish');
    }
  });
}
