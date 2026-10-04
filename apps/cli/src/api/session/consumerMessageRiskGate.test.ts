import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserMessage } from '../types';
import { createConsumerMessageRiskGate } from './consumerMessageRiskGate';

const message: UserMessage = { role: 'user', localId: 'synthetic-1', content: { type: 'text', text: 'Synthetic request' } };
const config = (evaluate: ReturnType<typeof vi.fn>, overrides = {}) => ({ providerId: 'synthetic-evaluator', threshold: 0.6, timeoutMs: 100, evaluate, ...overrides });
// The threshold is deliberately synthetic test data, not a calibrated Jev policy.
afterEach(() => vi.useRealTimers());

describe('consumer message risk gate', () => {
  it('allows only a valid score below the explicitly configured threshold', async () => {
    const evaluate = vi.fn().mockResolvedValue({ riskProbability: 0.2 });
    expect(await createConsumerMessageRiskGate(config(evaluate))('session', message)).toEqual({ decision: 'allow' });
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'synthetic-evaluator', sessionId: 'session', message, signal: expect.any(AbortSignal) }));
  });
  it('rejects risk at the configured threshold without a review decision', async () => {
    const evaluate = vi.fn().mockResolvedValue({ riskProbability: 0.6 });
    expect(await createConsumerMessageRiskGate(config(evaluate))('session', message)).toEqual({ decision: 'reject', code: 'consumer_risk_rejected', retryable: false });
  });
  it('fails closed with a retryable availability error when no provider is configured', async () => {
    expect(await createConsumerMessageRiskGate()('session', message)).toMatchObject({ decision: 'unavailable', code: 'consumer_risk_unavailable', retryable: true, reason: 'not_configured' });
  });
  it.each([NaN, -1, 1.1, '0.2', undefined])('does not allow malformed evaluator score %s', async (riskProbability) => {
    expect(await createConsumerMessageRiskGate(config(vi.fn().mockResolvedValue({ riskProbability })))('session', message)).toMatchObject({ decision: 'unavailable', retryable: true, reason: 'invalid_result' });
  });
  it.each([{ threshold: NaN }, { threshold: -1 }, { threshold: 1.1 }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { providerId: '' }])('does not invoke an evaluator with invalid configuration %j', async (overrides) => {
    const evaluate = vi.fn();
    expect(await createConsumerMessageRiskGate(config(evaluate, overrides))('session', message)).toMatchObject({ decision: 'unavailable', retryable: true, reason: 'invalid_configuration' });
    expect(evaluate).not.toHaveBeenCalled();
  });
  it('does not classify an evaluator exception as harmful content or expose its private details', async () => {
    const result = await createConsumerMessageRiskGate(config(vi.fn().mockRejectedValue(new Error('private-provider-detail'))))('session', message);
    expect(result).toEqual({ decision: 'unavailable', code: 'consumer_risk_unavailable', retryable: true, reason: 'evaluation_failed' });
  });
  it('bounds a hung evaluator and ignores a late safe result', async () => {
    vi.useFakeTimers();
    let resolve!: (value: { riskProbability: number }) => void;
    const evaluate = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
    const gate = createConsumerMessageRiskGate(config(evaluate));
    const pending = gate('session', message);
    await vi.advanceTimersByTimeAsync(100);
    expect(await pending).toMatchObject({ decision: 'unavailable', retryable: true, reason: 'timeout' });
    expect(evaluate.mock.calls[0][0].signal.aborted).toBe(true);
    resolve({ riskProbability: 0 });
    await Promise.resolve();
    expect(await pending).toMatchObject({ decision: 'unavailable', reason: 'timeout' });
    evaluate.mockResolvedValueOnce({ riskProbability: 0 });
    expect(await gate('session', message)).toEqual({ decision: 'allow' });
  });
  it('shares concurrent checks of the same payload but distinguishes changed content and session', async () => {
    let resolve!: (value: { riskProbability: number }) => void;
    const evaluate = vi.fn().mockImplementation(() => new Promise(r => { resolve = r; }));
    const gate = createConsumerMessageRiskGate(config(evaluate));
    const first = gate('session', message);
    const duplicate = gate('session', message);
    await Promise.resolve();
    expect(evaluate).toHaveBeenCalledTimes(1);
    resolve({ riskProbability: 0 });
    await Promise.all([first, duplicate]);
    evaluate.mockResolvedValue({ riskProbability: 0 });
    await gate('session', { ...message, content: { type: 'text', text: 'Changed synthetic request' } });
    await gate('other-session', message);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });
});
