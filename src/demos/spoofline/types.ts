// Shape of data.json, written by make_assets.py from the spoofline export and the
// committed run artifacts under docs/runs.

export type Stream = 'video' | 'audio';
export type Fusion = 'fused' | 'logistic';
export type Detector = Stream | Fusion;
export type Combo = 'bonafide' | 'video_only' | 'audio_only' | 'both';
export type Split = 'seen' | 'unseen';
/** Which stream triggered a weighted sum decision, spoofline.fusion.attribute's five words. */
export type Attribution = 'none' | 'video' | 'audio' | 'either' | 'joint';
export type Decision = 'attack' | 'bonafide';

export interface StreamCalibration {
  a: number;
  b: number;
  threshold: number;
  precision: number;
  recall: number;
}

export interface FusedCalibration {
  weight: number;
  threshold: number;
  precision: number;
  recall: number;
}

export interface LogisticCalibration {
  coefficients: { p_video: number; p_audio: number; disagreement: number };
  intercept: number;
  threshold: number;
  precision: number;
  recall: number;
}

export interface Metric {
  precision: number;
  recall: number;
  f1: number;
  auc: number;
  eer: number;
  n: number;
  nPositive: number;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
}

/** Mean, sample std and bootstrap 95% interval of the mean over the sweep's runs. */
export interface SweepStat {
  mean: number;
  std: number;
  ciLow: number;
  ciHigh: number;
  n: number;
}

export interface FalseAlarmRow {
  perturbation: string;
  stream: 'none' | Stream;
  severity: number | null;
  unit: string;
  n: number;
  video: number;
  audio: number;
  fused: number;
  logistic: number;
}

export interface AbstainRow {
  margin: number;
  coverage: number;
  kept: number;
  abstainedAttacks: number;
  abstainedBonafide: number;
  precision: number;
  recall: number;
}

export interface ClipRow {
  id: string;
  band: number;
  identity: string;
  videoFamily: string;
  audioFamily: string;
  label: 0 | 1;
  combo: Combo;
  split: 'seen_test' | 'unseen_test';
  unseen: boolean;
  gallery: string | null;
  videoLogit: number;
  audioLogit: number;
  videoProbability: number;
  audioProbability: number;
  fusedProbability: number;
  logisticProbability: number;
  videoFlags: boolean;
  audioFlags: boolean;
  decision: Decision;
  logisticDecision: Decision;
  triggeredBy: Attribution;
}

export interface DemoData {
  trainedFrom: string;
  trainedFromDescribe: string;
  profile: string;
  seed: number;
  targetPrecision: number;
  unseenFamilies: string[];
  runArtifacts: { results: string; robustness: string; export: string; sweep: string };
  families: Record<string, string>;
  corpus: { n_clips: number; n_identities: number; n_frames: number; frame_size: number; sample_rate: number };
  calibration: { video: StreamCalibration; audio: StreamCalibration; fused: FusedCalibration; logistic: LogisticCalibration };
  metrics: Record<Split, Record<Detector, Metric>>;
  headline: { verdict: string; logisticVerdict: string };
  attribution: Record<Split, Record<Fusion, Record<Combo, Record<Attribution, number>>>>;
  familyRates: Record<string, { n: number; detected: number; rate: number }>;
  sweep: {
    seeds: number[];
    runs: ({ seed: number } & Record<Detector, number>)[];
    unseen: Record<Detector, { precision: SweepStat; recall: SweepStat }>;
    gap: Record<Fusion, SweepStat>;
    wallClockS: number;
  };
  robustness: {
    bonafideClips: Record<'seen_test' | 'unseen_test', number>;
    falseAlarms: FalseAlarmRow[];
    margins: number[];
    abstain: Record<Split, Record<Fusion, AbstainRow[]>>;
  };
  export: { tolerance: number; parityClips: number; parity: Record<Stream, number> };
  calib: { label: number[]; video: number[]; audio: number[] };
  test: { label: number[]; unseen: number[]; video: number[]; audio: number[] };
  sheets: {
    frames: { cols: number; rows: number; size: number };
    spectrogram: { bands: number; frames: number; low: number; high: number };
  };
  clips: ClipRow[];
}
