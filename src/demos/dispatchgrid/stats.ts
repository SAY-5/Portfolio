// Port of the matching-service stats endpoint: counts, a trailing 60 s window
// for matches per minute, and latency percentiles over every recorded match.
export interface StatsSnapshot {
  matched: number;
  unmatched: number;
  dropped: number;
  matchesPerMinute: number;
  p50: number;
  p95: number;
  p99: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export class MatchStats {
  private readonly latencies: number[] = [];
  private readonly matchTimes: number[] = [];
  private matched = 0;
  private unmatched = 0;
  private dropped = 0;

  private readonly clock: () => number;

  constructor(clock: () => number) {
    this.clock = clock;
  }

  recordMatch(latencyMs: number): void {
    this.matched++;
    this.latencies.push(latencyMs);
    this.matchTimes.push(this.clock());
  }

  recordUnmatched(): void {
    this.unmatched++;
  }

  recordDropped(): void {
    this.dropped++;
  }

  snapshot(): StatsSnapshot {
    const now = this.clock();
    const since = now - 60_000;
    let start = 0;
    while (start < this.matchTimes.length && this.matchTimes[start] <= since) start++;
    const sorted = this.latencies.slice().sort((a, b) => a - b);
    return {
      matched: this.matched,
      unmatched: this.unmatched,
      dropped: this.dropped,
      matchesPerMinute: this.matchTimes.length - start,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p99: percentile(sorted, 0.99),
    };
  }
}
