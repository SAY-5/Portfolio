// Rolling shadow log: abs(shadow ETA - primary ETA) per request, capped at a
// window (MODELGATE_SHADOW_LOG_SIZE). The report is the same one
// /admin/shadow/report returns: count, mean and p95 absolute delta, and the
// share of requests beyond the 2.0 minute threshold.

export const THRESHOLD_MIN = 2.0;

export type ShadowReport = {
  n: number;
  meanAbs: number;
  p95Abs: number;
  beyond: number;
  bias: number;
};

export class ShadowLog {
  private deltas: number[] = [];
  private readonly size: number;
  constructor(size = 1000) {
    this.size = size;
  }

  record(primaryEta: number, shadowEta: number): void {
    this.deltas.push(shadowEta - primaryEta);
    if (this.deltas.length > this.size) this.deltas.shift();
  }

  clear(): void {
    this.deltas = [];
  }

  report(): ShadowReport {
    const n = this.deltas.length;
    if (n === 0) return { n: 0, meanAbs: 0, p95Abs: 0, beyond: 0, bias: 0 };
    const abs = this.deltas.map((d) => Math.abs(d)).sort((a, b) => a - b);
    const sum = abs.reduce((a, b) => a + b, 0);
    const bias = this.deltas.reduce((a, b) => a + b, 0) / n;
    const idx = Math.min(n - 1, Math.floor(0.95 * (n - 1)));
    const beyond = abs.filter((d) => d > THRESHOLD_MIN).length / n;
    return { n, meanAbs: sum / n, p95Abs: abs[idx], beyond, bias };
  }
}
