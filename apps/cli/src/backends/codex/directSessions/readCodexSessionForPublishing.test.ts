import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCodexSessionForPublishing } from './readCodexSessionForPublishing';

const homes: string[] = [];
async function fixture(threadId: string, lines: unknown[], tail = '') {
  const home = await mkdtemp(join(tmpdir(), 'combo-native-publish-'));
  homes.push(home);
  await mkdir(join(home, 'sessions'));
  const file = join(home, 'sessions', `rollout-2026-09-23T00-00-00-${threadId}.jsonl`);
  await writeFile(file, lines.map((v) => JSON.stringify(v)).join('\n') + '\n' + tail);
  return { home, file };
}
const meta = (id: string) => ({ type: 'session_meta', payload: { id, cwd: '/selected/project' } });
const message = (role: string, text: string) => ({ type: 'response_item', payload: { type: 'message', role, content: [{ type: 'text', text }] } });
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

describe('readCodexSessionForPublishing', () => {
  it('reads the exact thread complete text dialogue without resuming it or selecting newer neighbours', async () => {
    const selected = await fixture('selected-thread', [meta('selected-thread'), message('system', 'SYSTEM'), message('developer', 'DEVELOPER'),
      ...Array.from({ length: 251 }, (_, i) => message(i % 2 ? 'assistant' : 'user', `dialogue ${i}`)),
      { type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'PRIVATE REASONING' }] } },
      { type: 'response_item', payload: { type: 'function_call_output', output: 'TOOL' } }]);
    await writeFile(join(selected.home, 'sessions', 'rollout-2026-09-24T00-00-00-neighbour.jsonl'), JSON.stringify(meta('neighbour')) + '\n' + JSON.stringify(message('user', 'WRONG THREAD')) + '\n');
    const before = await readFile(selected.file);
    const result = await readCodexSessionForPublishing({ threadId: 'selected-thread', codexHome: selected.home });
    expect(result.directory).toBe('/selected/project');
    expect(result.items).toHaveLength(251);
    expect(result.items[0]?.raw).toEqual({ role: 'user', content: { type: 'text', text: 'dialogue 0' } });
    expect(result.items.at(-1)?.raw).toEqual({ role: 'user', content: { type: 'text', text: 'dialogue 250' } });
    expect(JSON.stringify(result.items)).not.toMatch(/SYSTEM|DEVELOPER|PRIVATE REASONING|WRONG THREAD|TOOL/);
    expect(await readFile(selected.file)).toEqual(before);
  });
  it('excludes only complete injected harness envelopes and preserves ordinary prompts mentioning AGENTS', async () => {
    const harness = '# AGENTS.md instructions for /owned/project\n\n<INSTRUCTIONS>\nRules\n</INSTRUCTIONS><environment_context>\n<cwd>/owned/project</cwd>\n</environment_context>';
    const f = await fixture('harness', [meta('harness'), message('user', harness), message('user', 'Please explain # AGENTS.md instructions and <environment_context> in this repository.'), message('assistant', 'Ordinary answer')]);
    const result = await readCodexSessionForPublishing({ threadId: 'harness', codexHome: f.home });
    expect(result.items).toHaveLength(2);
    expect(JSON.stringify(result.items)).toContain('Please explain # AGENTS.md');
    expect(JSON.stringify(result.items)).not.toContain('Rules');
  });
  it('fails closed on a partial trailing record instead of publishing incomplete history', async () => {
    const f = await fixture('partial', [meta('partial'), message('user', 'committed')], '{"type":"response_item"');
    await expect(readCodexSessionForPublishing({ threadId: 'partial', codexHome: f.home })).rejects.toThrow(/incomplete|committed/i);
  });
  it('rejects a filename match whose actual thread identity differs', async () => {
    const f = await fixture('chosen', [meta('different'), message('user', 'must not share')]);
    await expect(readCodexSessionForPublishing({ threadId: 'chosen', codexHome: f.home })).rejects.toThrow(/identity|thread/i);
  });
  it('does not replace missing native history with an app-server preview', async () => {
    const f = await fixture('other', [meta('other')]);
    await expect(readCodexSessionForPublishing({ threadId: 'absent', codexHome: f.home })).rejects.toThrow(/not found|unavailable/i);
  });
  it('fails on corrupt committed JSON instead of silently dropping it', async () => {
    const f = await fixture('corrupt', [meta('corrupt')], '{invalid}\n');
    await expect(readCodexSessionForPublishing({ threadId: 'corrupt', codexHome: f.home })).rejects.toThrow();
  });
});
