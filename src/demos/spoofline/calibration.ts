// Threshold selection at a target precision, ported from spoofline/calibrate.py by way of
// the repository's web/src/lib/calibration.ts, plus the two fusions of spoofline/fusion.py.
// The Platt parameters, the fusion weight and the logistic coefficients are the run's
// fitted values; only the thresholds are re-picked here.
import type { AbstainRow, Attribution, DemoData, Detector, LogisticCalibration } from './types';

export const DETECTORS: Detector[] = ['video', 'audio', 'fused', 'logistic'];

export interface CurvePoint {
  threshold: number;
  precision: number;
  recall: number;
}

export interface OperatingPoint extends CurvePoint {
  reached: boolean;
}

export interface Counts {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

export function platt(a: number, b: number, logit: number): number {
  return 1 / (1 + Math.exp(-(a * logit + b)));
}

/** spoofline.fusion.LogisticFusion.fuse: both probabilities, their gap, a clipped sigmoid. */
export function logisticFuse(model: LogisticCalibration, pVideo: number, pAudio: number): number {
  const c = model.coefficients;
  const z = c.p_video * pVideo + c.p_audio * pAudio + c.disagreement * Math.abs(pVideo - pAudio) + model.intercept;
  return 1 / (1 + Math.exp(-Math.min(60, Math.max(-60, z))));
}

/**
 * spoofline.fusion.attribute: which stream triggered a decision, silencing one stream at a
 * time. A silenced stream reports probability 0.
 */
export function attribute(decide: (pVideo: number, pAudio: number) => boolean, pVideo: number, pAudio: number): Attribution {
  if (!decide(pVideo, pAudio)) return 'none';
  const videoAlone = decide(pVideo, 0);
  const audioAlone = decide(0, pAudio);
  if (videoAlone && audioAlone) return 'either';
  if (videoAlone) return 'video';
  if (audioAlone) return 'audio';
  return 'joint';
}

/**
 * Calibrated probabilities for every detector: the fused one as w * p_video + (1 - w) * p_audio,
 * the logistic one from the run's fitted coefficients.
 */
export function calibrated(data: DemoData, video: number[], audio: number[]): Record<Detector, Float64Array> {
  const { calibration: cal } = data;
  const pv = Float64Array.from(video, (s) => platt(cal.video.a, cal.video.b, s));
  const pa = Float64Array.from(audio, (s) => platt(cal.audio.a, cal.audio.b, s));
  const w = cal.fused.weight;
  const pf = pv.map((v, i) => w * v + (1 - w) * pa[i]);
  const pl = pv.map((v, i) => logisticFuse(cal.logistic, v, pa[i]));
  return { video: pv, audio: pa, fused: pf, logistic: pl };
}

/** Precision and recall of `score >= t` at every distinct score, ascending in t. */
export function curve(scores: ArrayLike<number>, labels: ArrayLike<number>): CurvePoint[] {
  const n = scores.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => scores[i] - scores[j]);
  let positives = 0;
  for (let i = 0; i < n; i++) if (labels[i] === 1) positives++;
  const out: CurvePoint[] = [];
  let tp = positives;
  let fp = n - positives;
  let k = 0;
  while (k < n) {
    const t = scores[order[k]];
    if (tp + fp > 0) out.push({ threshold: t, precision: tp / (tp + fp), recall: tp / Math.max(1, positives) });
    while (k < n && scores[order[k]] === t) {
      if (labels[order[k]] === 1) tp--;
      else fp--;
      k++;
    }
  }
  return out;
}

/**
 * The lowest threshold whose precision reaches the target, which is the one with the most
 * recall; when no threshold reaches it, the one with the best precision.
 */
export function atPrecision(points: CurvePoint[], target: number): OperatingPoint {
  let best: CurvePoint | null = null;
  let fallback: CurvePoint | null = null;
  for (const p of points) {
    if (p.precision >= target && (best === null || p.recall > best.recall)) best = p;
    if (
      fallback === null ||
      p.precision > fallback.precision ||
      (p.precision === fallback.precision && p.recall > fallback.recall)
    ) {
      fallback = p;
    }
  }
  const chosen = best ?? fallback ?? { threshold: 1, precision: 0, recall: 0 };
  return { ...chosen, reached: best !== null };
}

export function countsAt(scores: ArrayLike<number>, labels: ArrayLike<number>, threshold: number, keep?: (i: number) => boolean): Counts {
  const c: Counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (let i = 0; i < scores.length; i++) {
    if (keep && !keep(i)) continue;
    const flagged = scores[i] >= threshold;
    const positive = labels[i] === 1;
    if (flagged && positive) c.tp++;
    else if (flagged) c.fp++;
    else if (positive) c.fn++;
    else c.tn++;
  }
  return c;
}

export function precisionOf(c: Counts): number {
  return c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0;
}

export function recallOf(c: Counts): number {
  return c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0;
}

/**
 * spoofline.robustness.abstain_curve for one margin: a clip is abstained on when
 * |p_video - p_audio| exceeds the margin; coverage is the share kept, precision and recall
 * are measured on the kept clips at the given fusion threshold.
 */
export function abstainAt(
  pVideo: ArrayLike<number>,
  pAudio: ArrayLike<number>,
  fused: ArrayLike<number>,
  labels: ArrayLike<number>,
  threshold: number,
  margin: number,
  keep?: (i: number) => boolean,
): AbstainRow {
  let total = 0;
  let kept = 0;
  let abstainedAttacks = 0;
  let abstainedBonafide = 0;
  const c: Counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (let i = 0; i < fused.length; i++) {
    if (keep && !keep(i)) continue;
    total++;
    const positive = labels[i] === 1;
    if (Math.abs(pVideo[i] - pAudio[i]) > margin) {
      if (positive) abstainedAttacks++;
      else abstainedBonafide++;
      continue;
    }
    kept++;
    const flagged = fused[i] >= threshold;
    if (flagged && positive) c.tp++;
    else if (flagged) c.fp++;
    else if (positive) c.fn++;
    else c.tn++;
  }
  return {
    margin,
    coverage: total ? kept / total : 0,
    kept,
    abstainedAttacks,
    abstainedBonafide,
    precision: precisionOf(c),
    recall: recallOf(c),
  };
}

/** Position on a log odds axis between 0.001 and 0.999, as a fraction of the axis. */
export function oddsFraction(p: number): number {
  const lo = Math.log(0.001 / 0.999);
  const q = Math.min(0.999, Math.max(0.001, p));
  return (Math.log(q / (1 - q)) - lo) / (-2 * lo);
}
