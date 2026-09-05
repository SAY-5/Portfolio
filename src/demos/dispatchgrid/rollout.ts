import { Rng } from './rng.ts';

// Deployment rollout model with the deploy/k8s settings: RollingUpdate,
// maxUnavailable 0, maxSurge 1, readiness probe every 5 s, preStop sleep 5 s,
// graceful shutdown. A new pod must pass readiness before an old one is
// terminated, and requests only route to Ready pods still in the endpoints.
export type PodPhase = 'Pending' | 'Starting' | 'Ready' | 'Terminating' | 'Gone';

export interface Pod {
  name: string;
  revision: number;
  phase: PodPhase;
  createdAt: number;
  terminatingAt: number | null;
  goneAt: number | null;
  served: number;
}

export interface Deployment {
  name: string;
  replicas: number;
  revision: number;
  pods: Pod[];
  rolledOutAt: number | null;
  served: number;
  errors: number;
}

export interface RolloutEvent {
  at: number;
  text: string;
}

export const PRESTOP_MS = 5000;
export const READINESS_PERIOD_MS = 5000;

interface Boot {
  startupMs: number;
  drainMs: number;
}

export class RolloutSim {
  readonly deployments: Deployment[];
  readonly events: RolloutEvent[] = [];
  private readonly boots = new Map<string, Boot>();
  private podSeq = 0;
  private readonly rnd: Rng;
  rolloutStartedAt: number | null = null;
  rolloutFinishedAt: number | null = null;
  now = 0;

  constructor(seed: number, specs: Array<{ name: string; replicas: number }>) {
    this.rnd = new Rng(seed);
    this.deployments = specs.map((s) => ({
      name: s.name,
      replicas: s.replicas,
      revision: 1,
      pods: [],
      rolledOutAt: null,
      served: 0,
      errors: 0,
    }));
    for (const d of this.deployments) {
      for (let i = 0; i < d.replicas; i++) {
        const p = this.createPod(d, 0);
        p.phase = 'Ready';
      }
    }
  }

  private createPod(d: Deployment, at: number): Pod {
    const suffix = (this.podSeq++).toString(36).padStart(5, 'x').slice(-5);
    const pod: Pod = {
      name: `${d.name}-${d.revision.toString(16).padStart(4, '0')}-${suffix}`,
      revision: d.revision,
      phase: 'Pending',
      createdAt: at,
      terminatingAt: null,
      goneAt: null,
      served: 0,
    };
    // JVM start and dependency warm up: real pods took 6 to 9 s to pass readiness.
    this.boots.set(pod.name, { startupMs: 5500 + this.rnd.next() * 3000, drainMs: 400 + this.rnd.next() * 900 });
    d.pods.push(pod);
    return pod;
  }

  get rolling(): boolean {
    return this.rolloutStartedAt !== null && this.rolloutFinishedAt === null;
  }

  // kubectl set env on every Deployment: bump the revision so pods are replaced.
  startRollout(): void {
    if (this.rolling) return;
    this.rolloutStartedAt = this.now;
    this.rolloutFinishedAt = null;
    for (const d of this.deployments) {
      d.revision++;
      d.rolledOutAt = null;
      this.log(`${d.name}: ROLLOUT_MARKER changed, revision ${d.revision} (maxUnavailable=0, maxSurge=1)`);
    }
  }

  private log(text: string): void {
    this.events.push({ at: this.now, text });
    if (this.events.length > 40) this.events.shift();
  }

  endpoints(d: Deployment): Pod[] {
    return d.pods.filter((p) => p.phase === 'Ready');
  }

  // Route one request through the Service: only Ready pods are endpoints.
  route(d: Deployment): Pod | null {
    const eps = this.endpoints(d);
    if (eps.length === 0) {
      d.errors++;
      return null;
    }
    const pod = eps[this.rnd.int(eps.length)];
    pod.served++;
    d.served++;
    return pod;
  }

  tick(dtMs: number): void {
    this.now += dtMs;
    for (const d of this.deployments) this.reconcile(d);
    if (this.rolling && this.deployments.every((d) => d.rolledOutAt !== null)) {
      this.rolloutFinishedAt = this.now;
      this.log(`rolling update finished in ${((this.now - (this.rolloutStartedAt ?? 0)) / 1000).toFixed(1)}s`);
    }
  }

  private reconcile(d: Deployment): void {
    for (const p of d.pods) {
      const boot = this.boots.get(p.name);
      if (!boot) continue;
      if (p.phase === 'Pending' && this.now - p.createdAt >= 300) p.phase = 'Starting';
      if (p.phase === 'Starting' && this.now - p.createdAt >= boot.startupMs) {
        // Readiness is probed every 5 s; the first pass after dependencies answer flips Ready.
        const sinceStart = this.now - p.createdAt - boot.startupMs;
        if (Math.floor(sinceStart / READINESS_PERIOD_MS) + 1 >= 1) {
          p.phase = 'Ready';
          this.log(`${p.name} ready (readiness probe passed)`);
        }
      }
      if (p.phase === 'Terminating' && p.terminatingAt !== null && this.now - p.terminatingAt >= PRESTOP_MS + boot.drainMs) {
        p.phase = 'Gone';
        p.goneAt = this.now;
        this.log(`${p.name} exited after graceful shutdown`);
      }
    }
    d.pods = d.pods.filter((p) => p.phase !== 'Gone' || (p.goneAt !== null && this.now - p.goneAt < 4000));

    if (d.rolledOutAt !== null || !this.rolling) return;

    const live = d.pods.filter((p) => p.phase !== 'Gone');
    const newPods = live.filter((p) => p.revision === d.revision);
    const oldPods = live.filter((p) => p.revision !== d.revision);
    const oldActive = oldPods.filter((p) => p.phase !== 'Terminating');
    const readyNew = newPods.filter((p) => p.phase === 'Ready').length;
    const readyTotal = this.endpoints(d).length;

    if (oldPods.length === 0 && newPods.length === d.replicas && readyNew === d.replicas) {
      d.rolledOutAt = this.now;
      this.log(`deployment "${d.name}" successfully rolled out`);
      return;
    }

    // maxSurge 1: at most replicas + 1 pods that are not terminating.
    const notTerminating = live.filter((p) => p.phase !== 'Terminating').length;
    if (newPods.length < d.replicas && notTerminating < d.replicas + 1) {
      const p = this.createPod(d, this.now);
      this.log(`${p.name} created (surge pod)`);
      return;
    }

    // maxUnavailable 0: scale the old set down only while ready pods stay at or above replicas.
    if (oldActive.length > 0 && readyTotal > d.replicas) {
      const victim = oldActive[0];
      victim.phase = 'Terminating';
      victim.terminatingAt = this.now;
      this.log(`${victim.name} terminating: removed from endpoints, preStop sleep 5`);
    }
  }

  get durationMs(): number | null {
    if (this.rolloutStartedAt === null) return null;
    return (this.rolloutFinishedAt ?? this.now) - this.rolloutStartedAt;
  }

  get totalErrors(): number {
    return this.deployments.reduce((n, d) => n + d.errors, 0);
  }

  get totalServed(): number {
    return this.deployments.reduce((n, d) => n + d.served, 0);
  }
}
