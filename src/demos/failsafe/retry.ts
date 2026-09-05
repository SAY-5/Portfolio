// Port of failsafe/retry.py: exponential backoff with jitter, capped, and the
// rule for which failures may be retried. Connection errors never reached the
// upstream so every method retries them; timeouts, dropped reads, and the
// listed statuses only retry for idempotent methods (or an Idempotency-Key).

export type FailureReason = 'connect' | 'timeout' | 'read' | 'status';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryOnStatus: number[];
  idempotentPost: boolean;
}

export const DEFAULT_RETRY: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 10,
  maxDelayMs: 150,
  retryOnStatus: [500, 502, 503, 504],
  idempotentPost: false,
};

const IDEMPOTENT = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']);

export function isRetryable(
  method: string,
  reason: FailureReason,
  policy: RetryPolicy,
  idempotencyKey = false,
): boolean {
  if (reason === 'connect') return true;
  return IDEMPOTENT.has(method) || policy.idempotentPost || idempotencyKey;
}

// Delay before retry number `attempt` (0-based): base * 2^attempt, capped at
// max, then jittered into [50%, 100%] of that value.
export function backoffMs(attempt: number, policy: RetryPolicy, rnd: () => number): number {
  const exp = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(exp * (0.5 + rnd() * 0.5));
}
