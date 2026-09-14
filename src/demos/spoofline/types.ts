// Shape of data.json, written by make_assets.py from the spoofline export.

export type Stream = 'video' | 'audio';
export type Detector = Stream | 'fused';
export type Combo = 'bonafide' | 'video_only' | 'audio_only' | 'both';

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
  videoFlags: boolean;
  audioFlags: boolean;
  decision: 'attack' | 'bonafide';
}

export interface DemoData {
  trainedFrom: string;
  seed: number;
  targetPrecision: number;
  unseenFamilies: string[];
  families: Record<string, string>;
  corpus: { n_clips: number; n_identities: number; n_frames: number; frame_size: number; sample_rate: number };
  calibration: { video: StreamCalibration; audio: StreamCalibration; fused: FusedCalibration };
  metrics: Record<'seen' | 'unseen', Record<Detector, Metric>>;
  familyRates: Record<string, { n: number; detected: number; rate: number }>;
  calib: { label: number[]; video: number[]; audio: number[] };
  test: { label: number[]; unseen: number[]; video: number[]; audio: number[] };
  sheets: {
    frames: { cols: number; rows: number; size: number };
    spectrogram: { bands: number; frames: number; low: number; high: number };
  };
  clips: ClipRow[];
}
