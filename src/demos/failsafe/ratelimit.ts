// Port of failsafe/ratelimit.py: one token bucket per key with exact refill
// math on a monotonic clock. A request takes one token; when the bucket is
// empty the answer is 429 with Retry-After equal to the time until the next
// whole token exists.

export interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}

export type TakeResult =
  | { allowed: true; tokens: number }
  | { allowed: false; tokens: number; retryAfterMs: number };

export class TokenBucket {
  config: BucketConfig;
  tokens: number;
  private last: number;

  constructor(config: BucketConfig, now: number) {
    this.config = config;
    this.tokens = config.capacity;
    this.last = now;
  }

  configure(config: BucketConfig, now: number): void {
    this.refill(now);
    this.config = config;
    this.tokens = Math.min(this.tokens, config.capacity);
  }

  refill(now: number): void {
    const elapsedS = Math.max(0, now - this.last) / 1000;
    this.tokens = Math.min(
      this.config.capacity,
      this.tokens + elapsedS * this.config.refillPerSecond,
    );
    this.last = now;
  }

  take(now: number): TakeResult {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, tokens: this.tokens };
    }
    const deficit = 1 - this.tokens;
    const retryAfterMs = Math.ceil((deficit / this.config.refillPerSecond) * 1000);
    return { allowed: false, tokens: this.tokens, retryAfterMs };
  }
}
