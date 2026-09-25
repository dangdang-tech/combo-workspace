import { realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import type { DirectTranscriptRawMessageV1 } from '@happier-dev/protocol';
import { readJsonlFileForward } from '@/api/directSessions/filePaging/jsonlForwardReader';
import { collectCodexSessionRolloutFiles } from './collectCodexSessionRolloutFiles';
import { captureCodexRolloutFileBoundary, codexRolloutFileBoundaryMatches } from './codexDirectRolloutFileBoundary';
import { readCodexMessageContentText } from '../utils/readCodexMessageContentText';

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Only the complete native injected envelope is excluded; ordinary AGENTS mentions remain dialogue. */
function isNativeHarnessEnvelope(text: string): boolean {
  const value = text.trim();
  return /^# AGENTS\.md instructions for [^\n]+\r?\n\s*<INSTRUCTIONS>[\s\S]*<\/INSTRUCTIONS>\s*<environment_context>[\s\S]*<\/environment_context>$/.test(value)
    || /^<environment_context>[\s\S]*<\/environment_context>$/.test(value);
}

/** Read-only, exact-thread text replay. Never starts/resumes Codex or falls back to a preview. */
export async function readCodexSessionForPublishing(params: Readonly<{
  threadId: string;
  codexHome: string;
}>): Promise<Readonly<{ directory: string; items: DirectTranscriptRawMessageV1[] }>> {
  const threadId = params.threadId.trim();
  if (!threadId || !isAbsolute(params.codexHome)) throw new Error('An exact native thread ID and absolute Codex home are required');
  const codexHome = await realpath(params.codexHome);
  const files = await collectCodexSessionRolloutFiles({ codexHome, remoteSessionId: threadId });
  if (files.length === 0) throw new Error('Native Codex transcript not found; no preview can replace its committed history');
  // Codex archival moves a rollout without changing its identity. Keep retry IDs stable across that move.
  const names = files.map((file) => basename(file.filePath));
  if (new Set(names).size !== names.length) throw new Error('Native transcript has ambiguous duplicate rollout identities');
  const items: DirectTranscriptRawMessageV1[] = [];
  let directory: string | null = null;
  // Capture every file boundary before reading. Later appends belong to a later publication.
  const captured = await Promise.all(files.map(async (file) => {
    const size = (await stat(file.filePath)).size;
    const boundary = await captureCodexRolloutFileBoundary(file.filePath, size);
    if (!boundary) throw new Error('Native transcript boundary unavailable');
    return { file, size, boundary: boundary.boundary };
  }));
  for (const { file, size, boundary } of captured) {
    let offset = 0;
    let identityVerified = false;
    while (offset < size) {
      const page = await readJsonlFileForward({
        filePath: file.filePath, offsetBytes: offset, endOffsetBytes: size,
        maxBytes: 512_000, maxItems: 200, strict: true,
      });
      if (page.truncated || page.nextOffsetBytes <= offset) throw new Error('Native transcript cannot be read completely');
      for (const line of page.items) {
        const envelope = record(line.value);
        const payload = record(envelope?.payload);
        if (envelope?.type === 'session_meta') {
          if (payload?.id !== threadId) throw new Error('Native transcript thread identity does not match the selected thread');
          identityVerified = true;
          if (typeof payload.cwd === 'string' && payload.cwd.trim()) directory = payload.cwd.trim();
          continue;
        }
        if (!identityVerified) throw new Error('Native transcript is missing its thread identity');
        if (envelope?.type !== 'response_item' || payload?.type !== 'message') continue;
        const role = payload.role;
        if (role !== 'user' && role !== 'assistant' && role !== 'agent') continue;
        const text = readCodexMessageContentText(payload.content);
        if (!text || (role === 'user' && isNativeHarnessEnvelope(text))) continue;
        const id = `codex-publication:${threadId}:${basename(file.filePath)}:${line.startOffsetBytes}`;
        items.push({
          id, localId: id,
          createdAtMs: typeof envelope.timestamp === 'string' ? Math.max(0, Date.parse(envelope.timestamp) || 0) : 0,
          messageRole: role === 'user' ? 'user' : 'agent',
          raw: role === 'user'
            ? { role: 'user', content: { type: 'text', text } }
            : { role: 'agent', content: { type: 'codex', data: { type: 'message', message: text } } },
        });
      }
      offset = page.nextOffsetBytes;
      if (page.reachedEnd) break;
    }
    if (!identityVerified || !await codexRolloutFileBoundaryMatches(file.filePath, boundary)) {
      throw new Error('Native transcript identity or committed boundary changed; retry after the writer finishes');
    }
  }
  if (!directory || !isAbsolute(directory)) throw new Error('Native transcript working directory is unavailable');
  if (items.length === 0) throw new Error('Native transcript has no committed user/assistant text to publish');
  return { directory, items };
}
