// Shared types for the in-browser rolling-deployment simulator. A Deployment
// owns a desired replica count and a rollout strategy; the engine drives a set
// of Pods from the current image version toward a target version one tick at a
// time, honouring maxSurge and maxUnavailable the way a Kubernetes rolling
// update does.

export type PodStatus = 'pending' | 'running' | 'failed' | 'terminating';

export type Pod = {
  id: string;
  // The image version this pod runs. During a rollout pods carry either the
  // old version or the new target version.
  version: string;
  status: PodStatus;
  // Ticks the pod has spent in 'pending' before it becomes 'running' or
  // 'failed'. Used by the engine to stage readiness over time.
  age: number;
};

export type RolloutStatus =
  | 'idle'
  | 'progressing'
  | 'paused'
  | 'complete'
  | 'rolled-back';

// Rolling-update knobs. maxSurge is how many pods above desired may exist
// while updating; maxUnavailable is how many below desired may be unavailable.
// Both are absolute pod counts here to keep the model legible.
export type Strategy = {
  maxSurge: number;
  maxUnavailable: number;
};

export type Deployment = {
  name: string;
  desired: number;
  // The version considered "current" once a rollout completes. Rollouts target
  // a new version; on success this becomes that version.
  currentVersion: string;
  strategy: Strategy;
  // Probability in [0, 1] that a freshly created pod of the rollout target
  // version fails its readiness check instead of becoming ready.
  newVersionFailureRate: number;
};

// The live rollout being driven toward a target version. Null target version
// means no rollout is in flight.
export type Rollout = {
  targetVersion: string | null;
  // Version pods are rolled back toward when a rollout is aborted.
  previousVersion: string;
  status: RolloutStatus;
  // Consecutive readiness failures of target-version pods. The rollout pauses
  // when this reaches failureThreshold.
  failureCount: number;
  failureThreshold: number;
};

// One entry in the per-tick history shown on the timeline.
export type HistoryPoint = {
  tick: number;
  available: number;
  updated: number;
  desired: number;
  status: RolloutStatus;
};

export type RolloutEvent =
  | { kind: 'pod-created'; podId: string; version: string }
  | { kind: 'pod-ready'; podId: string; version: string }
  | { kind: 'pod-failed'; podId: string; version: string }
  | { kind: 'pod-terminating'; podId: string; version: string }
  | { kind: 'paused'; failures: number }
  | { kind: 'resumed' }
  | { kind: 'rolled-back'; to: string }
  | { kind: 'complete'; version: string }
  | { kind: 'started'; from: string; to: string };

export type SimState = {
  deployment: Deployment;
  pods: Pod[];
  rollout: Rollout;
  history: HistoryPoint[];
  events: RolloutEvent[];
  tick: number;
  // Monotonic counter used to mint stable pod ids without Math.random.
  seq: number;
  // PRNG seed advanced deterministically on every tick.
  seed: number;
};
