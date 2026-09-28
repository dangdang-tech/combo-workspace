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
import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';
import { readCredentials, readSettings } from '@/persistence';
import { previewNativeSessionPublication, publishSession } from '@/session/sharing/publishSession';

type Failure = Extract<DirectSessionPublishResponse, { ok: false }>;
function failure(errorCode: Failure['errorCode'], error = errorCode): Failure {
  return { ok: false, errorCode, error };
}
function publicationFailure(error: unknown): Failure {
  const code = error instanceof Error && 'code' in error ? error.code : null;
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
      return publicationFailure(error);
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
      return publicationFailure(error);
    }
  });
}
