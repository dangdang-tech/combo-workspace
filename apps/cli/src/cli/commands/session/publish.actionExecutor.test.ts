import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureConsoleJsonOutput } from '@/testkit/logger/captureOutput';

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/session/actions/createCliActionExecutorFromCredentials', () => ({
  createCliActionExecutorFromCredentials: () => ({ execute }),
}));
vi.mock('@/settings/accountSettings/bootstrapAccountSettingsContext', () => ({ bootstrapAccountSettingsContext: vi.fn() }));

import { handleSessionCommand } from './handleSessionCommand';

const credentials = { token: 'fixture-token', encryption: { type: 'legacy' as const, secret: new Uint8Array(32) } };
const published = { sourceSessionId: 'source-1', entryId: 'entry-1', inviteUrl: 'https://combo.test/invite/example' };

async function run(argv: string[]) {
  const output = captureConsoleJsonOutput();
  try {
    await handleSessionCommand(['publish', ...argv, '--json'], { readCredentialsFn: async () => credentials });
    return output.json();
  } finally { output.restore(); }
}

describe('happier session publish', () => {
  beforeEach(() => { execute.mockReset(); execute.mockResolvedValue({ ok: true, result: published }); vi.stubEnv('HAPPIER_SESSION_ID', ''); vi.stubEnv('CODEX_THREAD_ID', 'native-ambient-thread'); });
  afterEach(() => { vi.unstubAllEnvs(); process.exitCode = undefined; });

  it('publishes an explicit existing COMBO session and prints the invitation result', async () => {
    expect(await run(['source-1', '--title', 'Share context', '--description', 'Purpose'])).toMatchObject({ ok: true, kind: 'session_publish', data: published });
    expect(execute).toHaveBeenCalledWith('session.publish', { source: { kind: 'session', sessionId: 'source-1' }, title: 'Share context', description: 'Purpose' }, { surface: 'cli', defaultSessionId: null });
  });

  it('uses only HAPPIER_SESSION_ID as the implicit existing source', async () => {
    vi.stubEnv('HAPPIER_SESSION_ID', 'trusted-combo-session');
    expect(await run(['--title', 'Share context'])).toMatchObject({ ok: true });
    expect(execute).toHaveBeenCalledWith('session.publish', { source: { kind: 'session', sessionId: 'trusted-combo-session' }, title: 'Share context' }, { surface: 'cli', defaultSessionId: null });
  });

  it('accepts native thread only with explicit thread and home', async () => {
    expect(await run(['--codex-thread', 'selected-native', '--codex-home', '/fixture/codex', '--title', 'Native', '--publisher-display-name', 'Owner'])).toMatchObject({ ok: true });
    expect(execute).toHaveBeenCalledWith('session.publish', { source: { kind: 'codex', threadId: 'selected-native', codexHome: '/fixture/codex' }, title: 'Native', publisherDisplayName: 'Owner' }, { surface: 'cli', defaultSessionId: null });
  });

  it.each([
    ['--title', 'No trusted source'],
    ['--codex-thread', 'selected-native', '--title', 'Missing home'],
    ['source-1', '--codex-thread', 'selected-native', '--codex-home', '/fixture/codex', '--title', 'Ambiguous'],
    ['source-1'],
  ])('rejects missing or ambiguous source/title: %j', async (...argv) => {
    expect(await run(argv)).toMatchObject({ ok: false });
    expect(execute).not.toHaveBeenCalled();
  });
});
