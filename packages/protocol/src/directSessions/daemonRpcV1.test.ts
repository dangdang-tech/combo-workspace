import { describe, expect, it } from 'vitest';

import * as directSessionsRpc from './daemonRpcV1';
import { DirectSessionsSourceSchema, DirectTranscriptRawMessageV1Schema } from './daemonRpcV1';

describe('DirectSessionsSourceSchema', () => {
  it('accepts exact Codex user-home identity', () => {
    expect(DirectSessionsSourceSchema.parse({
      kind: 'codexHome',
      home: 'user',
      homePath: '/tmp/custom-codex-home',
    })).toEqual({
      kind: 'codexHome',
      home: 'user',
      homePath: '/tmp/custom-codex-home',
    });
  });

  it('accepts exact Codex connected-service profile identity', () => {
    expect(DirectSessionsSourceSchema.parse({
      kind: 'codexHome',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: 'work',
      homePath: '/tmp/connected/work/codex-home',
    })).toEqual({
      kind: 'codexHome',
      home: 'connectedService',
      connectedServiceId: 'openai-codex',
      connectedServiceProfileId: 'work',
      homePath: '/tmp/connected/work/codex-home',
    });
  });
});

describe('DirectTranscriptRawMessageV1Schema', () => {
  const item = {
    id: 'direct-1',
    createdAtMs: 1_700,
    raw: { role: 'agent', content: { type: 'output', data: { type: 'assistant' } } },
  };

  it('preserves canonical message-role metadata for downstream normalization', () => {
    expect(DirectTranscriptRawMessageV1Schema.parse({ ...item, messageRole: 'event' })).toMatchObject({
      messageRole: 'event',
    });
  });

  it('rejects invalid message-role metadata', () => {
    expect(DirectTranscriptRawMessageV1Schema.safeParse({ ...item, messageRole: 'not-a-role' }).success).toBe(false);
  });
});

describe('direct session follow lifecycle schemas', () => {
  it('parses attach, detach, and follow-policy requests', () => {
    const attachSchema = (directSessionsRpc as Record<string, any>).DirectSessionAttachRequestSchema;
    const detachSchema = (directSessionsRpc as Record<string, any>).DirectSessionDetachRequestSchema;
    const followPolicySchema = (directSessionsRpc as Record<string, any>).DirectSessionFollowPolicySetRequestSchema;

    expect(attachSchema.parse({
      machineId: 'machine-1',
      sessionId: 'session-1',
      providerId: 'claude',
      remoteSessionId: 'remote-1',
      source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'project-1' },
      leaseId: 'lease-1',
      ttlMs: 30_000,
    })).toEqual({
      machineId: 'machine-1',
      sessionId: 'session-1',
      providerId: 'claude',
      remoteSessionId: 'remote-1',
      source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'project-1' },
      leaseId: 'lease-1',
      ttlMs: 30_000,
    });

    expect(detachSchema.parse({
      machineId: 'machine-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
    })).toEqual({
      machineId: 'machine-1',
      sessionId: 'session-1',
      leaseId: 'lease-1',
    });

    expect(followPolicySchema.parse({
      machineId: 'machine-1',
      sessionId: 'session-1',
      providerId: 'claude',
      remoteSessionId: 'remote-1',
      source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'project-1' },
      enabled: true,
    })).toEqual({
      machineId: 'machine-1',
      sessionId: 'session-1',
      providerId: 'claude',
      remoteSessionId: 'remote-1',
      source: { kind: 'claudeConfig', configDir: '/tmp/.claude', projectId: 'project-1' },
      enabled: true,
    });
  });
});

describe('native publication review contract', () => {
  const target = { machineId: 'm1', providerId: 'codex', remoteSessionId: 'thread-1', source: { kind: 'codexHome', home: 'user' } };
  it('requires an exact reviewed fingerprint before publication', () => {
    expect(directSessionsRpc.DirectSessionPublishPreviewRequestSchema.parse(target)).toEqual(target);
    expect(directSessionsRpc.DirectSessionPublishRequestSchema.safeParse({ ...target, title: 'Shared' }).success).toBe(false);
    expect(directSessionsRpc.DirectSessionPublishRequestSchema.parse({ ...target, title: ' Shared ', expectedSnapshotFingerprint: 'a'.repeat(64) }).title).toBe('Shared');
  });
  it('rejects path-like native identities and non-Codex providers', () => {
    for (const remoteSessionId of ['../private', 'a/b', 'a\\\\b', '.', '..']) {
      expect(directSessionsRpc.DirectSessionPublishPreviewRequestSchema.safeParse({ ...target, remoteSessionId }).success).toBe(false);
    }
    expect(directSessionsRpc.DirectSessionPublishPreviewRequestSchema.safeParse({ ...target, providerId: 'claude' }).success).toBe(false);
  });
  it('keeps new text previews distinct from an already published frozen link', () => {
    const publication = { sourceSessionId: 's1', entryId: 'e1', inviteUrl: 'https://combo.test/invite/token' };
    expect(directSessionsRpc.DirectSessionPublishPreviewResponseSchema.parse({ ok: true, status: 'already_published', publication })).toEqual({ ok: true, status: 'already_published', publication });
    expect(directSessionsRpc.DirectSessionPublishPreviewResponseSchema.safeParse({ ok: true, status: 'ready', snapshotFingerprint: 'b'.repeat(64), directory: '/project', messages: [{ role: 'tool', text: 'private' }] }).success).toBe(false);
    expect(directSessionsRpc.DirectSessionPublishResponseSchema.parse({ ok: false, errorCode: 'snapshot_changed', error: 'Preview again' }).errorCode).toBe('snapshot_changed');
  });
});
