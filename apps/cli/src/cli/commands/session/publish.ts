import type { ActionExecutorDeps } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import { readCurrentHappierSessionIdFromEnv } from '@/agent/runtime/session/currentSessionIdEnv';
import { readCommandPositionals, readFlagValue } from '@/cli/commands/shared/argvFlags';
import { wantsJson, printJsonEnvelope } from '@/cli/output/jsonEnvelope';
import { createCliActionExecutorFromCredentials } from '@/session/actions/createCliActionExecutorFromCredentials';
import { normalizeActionExecuteResult } from './shared/normalizeActionExecuteResult';
import { tryHandleApprovalRequestCreated } from './shared/tryHandleApprovalRequestCreated';

export const SESSION_PUBLISH_USAGE = 'happier session publish [session-id] --title <title> [--codex-thread <thread-id> --codex-home <path>] [--description <text>] [--publisher-display-name <name>] [--machine-id <id>] [--json]';
const VALUE_FLAGS = ['--title', '--codex-thread', '--codex-home', '--description', '--publisher-display-name', '--machine-id'] as const;

export async function cmdSessionPublish(
  argv: string[],
  deps: Readonly<{ readCredentialsFn: () => Promise<Credentials | null> }>,
): Promise<void> {
  const invalidArguments = () => Object.assign(new Error(`Usage: ${SESSION_PUBLISH_USAGE}`), { code: 'invalid_arguments' });
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('-')) continue;
    if (value === '--json') continue;
    if (!VALUE_FLAGS.some((flag) => flag === value) || !argv[index + 1]?.trim() || argv[index + 1].startsWith('--')) {
      throw invalidArguments();
    }
    index += 1;
  }
  const positionals = readCommandPositionals(argv, { startIndex: 1, valueFlags: VALUE_FLAGS });
  const title = readFlagValue(argv, '--title');
  const threadId = readFlagValue(argv, '--codex-thread');
  const codexHome = readFlagValue(argv, '--codex-home');
  if (!title || positionals.length > 1 || Boolean(threadId) !== Boolean(codexHome) || (threadId && positionals.length > 0)) {
    throw invalidArguments();
  }
  type PublishInput = Parameters<NonNullable<ActionExecutorDeps['sessionPublish']>>[0];
  const sessionId = positionals[0] || readCurrentHappierSessionIdFromEnv();
  const source: PublishInput['source'] | null = threadId && codexHome
    ? { kind: 'codex', threadId, codexHome }
    : sessionId ? { kind: 'session', sessionId } : null;
  if (!source) throw invalidArguments();
  const description = readFlagValue(argv, '--description');
  const publisherDisplayName = readFlagValue(argv, '--publisher-display-name');
  const machineId = readFlagValue(argv, '--machine-id');
  const json = wantsJson(argv);
  const credentials = await deps.readCredentialsFn();
  if (!credentials) {
    if (json) {
      await printJsonEnvelope({ ok: false, kind: 'session_publish', error: { code: 'not_authenticated' } });
      return;
    }
    throw Object.assign(new Error('Not authenticated. Run "happier auth login" first.'), { code: 'not_authenticated' });
  }
  const executor = createCliActionExecutorFromCredentials({ credentials });
  const actionResult = await executor.execute('session.publish', {
    source,
    title,
    ...(description ? { description } : {}),
    ...(publisherDisplayName ? { publisherDisplayName } : {}),
    ...(machineId ? { machineId } : {}),
  }, { surface: 'cli', defaultSessionId: null });
  const normalized = normalizeActionExecuteResult(actionResult);
  if (!normalized.ok) {
    if (json) {
      await printJsonEnvelope({ ok: false, kind: 'session_publish', error: { code: normalized.errorCode, ...(normalized.errorMessage ? { message: normalized.errorMessage } : {}) } });
      return;
    }
    throw Object.assign(new Error(normalized.errorMessage ?? normalized.errorCode), { code: normalized.errorCode });
  }
  if (await tryHandleApprovalRequestCreated({ envelopeKind: 'session_publish', json, result: normalized.data })) return;
  if (json) {
    await printJsonEnvelope({ ok: true, kind: 'session_publish', data: normalized.data });
    return;
  }
  const result = normalized.data;
  if (!result || typeof result !== 'object' || !('inviteUrl' in result) || typeof result.inviteUrl !== 'string') {
    throw new Error('Publication did not return an invitation URL');
  }
  console.log(result.inviteUrl);
}
