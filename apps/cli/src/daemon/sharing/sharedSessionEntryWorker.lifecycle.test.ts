import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerFeaturesClientForTests } from '@/features/serverFeaturesClient';
import { startSharedSessionEntryWorker } from './sharedSessionEntryWorker';

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  return { ...actual, default: { ...actual.default, post: vi.fn() } };
});

describe('shared session entry worker lifecycle', () => {
  let enabled: boolean;
  beforeEach(() => {
    enabled = true; vi.useFakeTimers(); vi.clearAllMocks(); resetServerFeaturesClientForTests();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ features: { sharing: {
      session: { enabled: true }, contentKeys: { enabled: true }, sessionEntries: { enabled },
    } }, capabilities: {} }), { status: 200 })));
    vi.mocked(axios.post).mockResolvedValue({ data: { assignment: null } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); resetServerFeaturesClientForTests(); });
  function start() {
    return startSharedSessionEntryWorker({ credentials: { token: 'host', encryption: { type: 'legacy', secret: new Uint8Array(32) } },
      machineId: 'machine', isOnline: () => true, directTransport: { spawn: async () => { throw new Error('unexpected spawn'); } } });
  }
  it('polls while enabled and stops all subsequent work at shutdown', async () => {
    const worker = start();
    worker.trigger();
    await vi.advanceTimersByTimeAsync(1);
    expect(axios.post).toHaveBeenCalledTimes(1);
    worker.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
  it('does not use a missing or disabled feature bit as permission to allocate sessions', async () => {
    enabled = false;
    const worker = start(); worker.trigger();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(axios.post).not.toHaveBeenCalled(); worker.stop();
  });
  it('pauses on disconnect and resumes with one pending allocation poll', async () => {
    const worker = start(); worker.pause(); worker.trigger();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(axios.post).not.toHaveBeenCalled();
    worker.resume();
    await vi.advanceTimersByTimeAsync(1);
    expect(axios.post).toHaveBeenCalledTimes(1); worker.stop();
  });
});
