import type { UserMessage } from '../types';

export type ConsumerMessageRiskResult =
  | Readonly<{ decision: 'allow' }>
  | Readonly<{ decision: 'reject'; code: 'consumer_risk_rejected'; retryable: false }>
  | Readonly<{
      decision: 'unavailable'; code: 'consumer_risk_unavailable'; retryable: true;
      reason: 'not_configured' | 'invalid_configuration' | 'invalid_result' | 'evaluation_failed' | 'timeout' | 'runtime_authority_lost';
    }>;

/** The adapter owns its assessment; COMBO owns the configured refusal threshold. */
export type ConsumerMessageRiskConfig = Readonly<{
  providerId: string;
  threshold: number;
  /** Explicit evaluator-request budget, never an implicit safety-policy default. */
  timeoutMs: number;
  evaluate: (input: Readonly<{
    providerId: string; sessionId: string; message: UserMessage; signal: AbortSignal;
  }>) => Promise<Readonly<{ riskProbability: number }>>;
}>;

function unavailable(reason: Extract<ConsumerMessageRiskResult, { decision: 'unavailable' }>['reason']): ConsumerMessageRiskResult {
  return { decision: 'unavailable', code: 'consumer_risk_unavailable', retryable: true, reason };
}

/** No credentials, network client, calibrated defaults, or human-review queue live here. */
export function createConsumerMessageRiskGate(config?: ConsumerMessageRiskConfig) {
  const snapshot = config ? { ...config } : undefined;
  const inFlight = new Map<string, Promise<ConsumerMessageRiskResult>>();
  return (sessionId: string, message: UserMessage): Promise<ConsumerMessageRiskResult> => {
    if (!snapshot) return Promise.resolve(unavailable('not_configured'));
    if (typeof snapshot.providerId !== 'string' || !snapshot.providerId.trim() || !Number.isFinite(snapshot.threshold)
      || snapshot.threshold < 0 || snapshot.threshold > 1
      || !Number.isFinite(snapshot.timeoutMs) || snapshot.timeoutMs <= 0
      || typeof snapshot.evaluate !== 'function') {
      return Promise.resolve(unavailable('invalid_configuration'));
    }
    // Pending payloads are JSON. Include every supplied input, not only localId:
    // a substituted payload must never inherit another message's safe assessment.
    let key: string;
    try { key = JSON.stringify([sessionId, message]); }
    catch { return Promise.resolve(unavailable('evaluation_failed')); }
    const existing = inFlight.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<ConsumerMessageRiskResult>(resolve => {
      timer = setTimeout(() => {
        controller.abort();
        resolve(unavailable('timeout'));
      }, snapshot.timeoutMs);
    });
    const evaluated = Promise.resolve().then(async (): Promise<ConsumerMessageRiskResult> => {
      try {
        const result = await snapshot.evaluate({ providerId: snapshot.providerId, sessionId, message, signal: controller.signal });
        const score = result?.riskProbability;
        if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return unavailable('invalid_result');
        return score >= snapshot.threshold
          ? { decision: 'reject', code: 'consumer_risk_rejected', retryable: false }
          : { decision: 'allow' };
      } catch { return unavailable('evaluation_failed'); }
    });
    const checked = Promise.race([evaluated, timeout]).finally(() => {
      clearTimeout(timer);
      if (inFlight.get(key) === checked) inFlight.delete(key);
    });
    inFlight.set(key, checked);
    return checked;
  };
}

/** A pre-effect refusal; never an Agent/provider rejection after execution. */
export class ConsumerMessageRiskBlockedError extends Error {
  constructor(readonly result: Exclude<ConsumerMessageRiskResult, { decision: 'allow' }>) {
    super(result.code);
    this.name = 'ConsumerMessageRiskBlockedError';
  }
}
