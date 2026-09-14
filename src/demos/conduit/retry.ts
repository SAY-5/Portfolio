// Port of conduit/core/retry.py: 429, 5xx and timeouts are transient and
// retried with exponential backoff and full jitter; any other 4xx is permanent
// and returned to the queue at once, where SQS redrive decides its fate.
import type { Rng } from './prng';
import type { RetryPolicy } from './specs';

export class DeliveryError extends Error {
  readonly retryable: boolean = false;
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.status = status;
  }
}

export class TransientError extends DeliveryError {
  override readonly retryable: boolean = true;
  readonly retryAfter: number | null;

  constructor(message: string, status: number | null, retryAfter: number | null) {
    super(message, status);
    this.retryAfter = retryAfter;
  }
}

export class PermanentError extends DeliveryError {}

export interface FakeResponse {
  status: number;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function classifyResponse(response: FakeResponse, policy: RetryPolicy): DeliveryError | null {
  const { status } = response;
  if (status >= 200 && status < 300) return null;
  const body = JSON.stringify(response.body).slice(0, 200);
  if (policy.retryOnStatus.includes(status) || status >= 500) {
    const ra = Number(response.headers['Retry-After']);
    return new TransientError(`HTTP ${status}: ${body}`, status, response.headers['Retry-After'] !== undefined && Number.isFinite(ra) ? Math.max(0, ra) : null);
  }
  return new PermanentError(`HTTP ${status}: ${body}`, status);
}

// uniform(0, min(cap, base * multiplier^(attempt - 1)))
export function backoffCeiling(attempt: number, policy: RetryPolicy): number {
  return Math.min(policy.maxSeconds, policy.baseSeconds * policy.multiplier ** (attempt - 1));
}

export interface RetryOutcome {
  attempts: number;
  delays: number[];
}

// Call fn until it succeeds, raises a permanent error, or exhausts attempts.
export function retryCall<T>(
  fn: () => T,
  policy: RetryPolicy,
  rng: Rng,
  sleep: (seconds: number) => void,
  onRetry: (attempt: number, delay: number, err: TransientError) => void,
): { value: T; outcome: RetryOutcome } {
  const outcome: RetryOutcome = { attempts: 0, delays: [] };
  for (;;) {
    outcome.attempts += 1;
    try {
      return { value: fn(), outcome };
    } catch (exc) {
      const err = exc instanceof DeliveryError ? exc : new PermanentError(String(exc), null);
      if (!(err instanceof TransientError) || outcome.attempts >= policy.maxAttempts) {
        (err as DeliveryError & { outcome?: RetryOutcome }).outcome = outcome;
        throw err;
      }
      let delay = rng.uniform(0, backoffCeiling(outcome.attempts, policy));
      if (err.retryAfter !== null) delay = Math.min(policy.maxSeconds, Math.max(delay, err.retryAfter));
      outcome.delays.push(delay);
      onRetry(outcome.attempts, delay, err);
      sleep(delay);
    }
  }
}
