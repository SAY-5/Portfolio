// The burst from scripts/demo.py as a generator: 300 events (250 unique, 50
// re-sends with fresh signatures), 20 tagged so the receiver answers 400, 30
// tagged so it answers 503 twice, three bad signatures, then a bulk replay once
// the destination is repaired. Each yield is a progress snapshot; every figure
// is read back from /stats.
import type { Json } from './signing';
import { Service } from './service';
import type { Stats } from './store';

export const BURST = { total: 300, duplicates: 50, hard: 20, flaky: 30, flakyFailures: 2, badSignatures: 3, source: 'demo', secret: 'demo-dev-secret', pollEvery: 8 };

export type BurstPhase = 'idle' | 'first-pass' | 'duplicates' | 'rejections' | 'settling' | 'replay' | 'resettling' | 'done';

export interface BurstProgress {
  phase: BurstPhase;
  posted: number;
  accepted: number;
  deduplicated: number;
  rejectionStatuses: number[];
  since: number;
  hardTag: string;
  flakyTag: string;
  stats: Stats;
  failedFirstPass: number | null;
  deliveredFirstPass: number | null;
  replayed: number | null;
  checks: { name: string; ok: boolean }[];
  lines: string[];
}

export function* runBurst(service: Service): Generator<BurstProgress, BurstProgress, void> {
  const runId = service.rng.hex(8);
  const since = service.clock.now();
  const p: BurstProgress = {
    phase: 'first-pass',
    posted: 0,
    accepted: 0,
    deduplicated: 0,
    rejectionStatuses: [],
    since,
    hardTag: `hard-${runId}`,
    flakyTag: `flaky-${runId}`,
    stats: service.stats({ source: BURST.source, since }),
    failedFirstPass: null,
    deliveredFirstPass: null,
    replayed: null,
    checks: [],
    lines: [],
  };
  const snap = (): BurstProgress => {
    p.stats = service.stats({ source: BURST.source, since });
    return { ...p, rejectionStatuses: [...p.rejectionStatuses] };
  };
  service.receiver.clearRules();
  service.receiver.addRule({ tag: p.hardTag, status: 400 });
  service.receiver.addRule({ tag: p.flakyTag, status: 503, times: BURST.flakyFailures });

  const unique = BURST.total - BURST.duplicates;
  const payloads: Record<string, Json>[] = [];
  for (let i = 0; i < unique; i++) {
    const payload: Record<string, Json> = { id: `demo-${runId}-${String(i).padStart(4, '0')}`, sequence: i, kind: 'burst' };
    if (i < BURST.hard) payload.tag = p.hardTag;
    else if (i < BURST.hard + BURST.flaky) payload.tag = p.flakyTag;
    payloads.push(payload);
  }
  const plain = payloads.filter((x) => !('tag' in x));
  const duplicates = Array.from({ length: BURST.duplicates }, (_, i) => plain[i % plain.length]);

  // The first event is signed by hand so its exact request can be replayed later.
  const lead = service.sign(BURST.source, payloads[0], { secret: BURST.secret });
  for (let i = 0; i < payloads.length; i++) {
    const r = i === 0 ? service.webhook(lead) : service.post(BURST.source, payloads[i], { secret: BURST.secret });
    p.posted += 1;
    if (r.status === 202) p.accepted += 1;
    if (i > 0) {
      service.clock.advance(3);
      if (i % BURST.pollEvery === 0) service.worker.runOnce();
    }
    if (i % 5 === 0) yield snap();
  }

  p.phase = 'duplicates';
  service.clock.advance(1050); // fresh timestamps, so re-sends are dedup hits rather than replays
  for (let i = 0; i < duplicates.length; i++) {
    const r = service.post(BURST.source, duplicates[i], { secret: BURST.secret });
    p.posted += 1;
    if (r.result?.deduplicated) p.deduplicated += 1;
    service.clock.advance(3);
    if (i % BURST.pollEvery === 0) service.worker.runOnce();
    if (i % 5 === 0) yield snap();
  }

  p.phase = 'rejections';
  const stale = service.clock.seconds() - 3600;
  p.rejectionStatuses.push(service.post(BURST.source, { id: `bad-${runId}-1` }, { secret: 'wrong-secret' }).status);
  yield snap();
  p.rejectionStatuses.push(service.post(BURST.source, { id: `bad-${runId}-2` }, { secret: BURST.secret, timestamp: stale }).status);
  yield snap();
  p.rejectionStatuses.push(service.webhook(lead).status);
  yield snap();

  p.phase = 'settling';
  yield* settle(service, snap);
  const before = service.stats({ source: BURST.source, since });
  p.failedFirstPass = before.deliveries.failed;
  p.deliveredFirstPass = before.deliveries.delivered;

  p.phase = 'replay';
  service.receiver.clearRules();
  p.replayed = service.replayBulk({ source: BURST.source, since }, 'destination repaired').length;
  yield snap();

  p.phase = 'resettling';
  yield* settle(service, snap);

  const after = service.stats({ source: BURST.source, since });
  p.checks = [
    { name: 'deduplicated == duplicates', ok: after.events.deduplicated === BURST.duplicates },
    { name: 'failed before replay == hard failures', ok: p.failedFirstPass === BURST.hard },
    { name: 'replayed == hard failures', ok: p.replayed === BURST.hard },
    { name: 'all replays delivered', ok: after.replays.delivered === p.replayed },
    { name: 'nothing left failed', ok: after.deliveries.failed === 0 },
    { name: 'signature rejections == bad requests', ok: after.signature_rejections === BURST.badSignatures },
  ];
  p.lines = [
    '== LaunchBridge demo summary ==',
    `events received:        ${after.events.received}`,
    `  unique accepted:      ${after.events.accepted}`,
    `  deduplicated:         ${after.events.deduplicated}   (duplicates sent: ${BURST.duplicates})`,
    `deliveries delivered:   ${after.deliveries.delivered}   (${p.deliveredFirstPass} first pass + ${after.replays.delivered} after replay)`,
    `deliveries retried:     ${after.retries}   (attempts beyond the first)`,
    `deliveries failed:      ${p.failedFirstPass}   (hard failures injected: ${BURST.hard})`,
    `replayed after fix:     ${p.replayed}   -> delivered ${after.replays.delivered}, still failed ${after.deliveries.failed}`,
    `signature rejections:   ${after.signature_rejections}   (sent: wrong secret, stale timestamp, replayed signature)`,
    `dispatch latency:       p50 ${after.latency_ms.p50} ms   p95 ${after.latency_ms.p95} ms`,
    ...p.checks.map((c) => `check ${c.ok ? 'ok ' : 'BAD'}  ${c.name}`),
  ];
  p.phase = 'done';
  return snap();
}

// Drain what is due, then jump the clock to the next backoff deadline.
function* settle(service: Service, snap: () => BurstProgress): Generator<BurstProgress, void, void> {
  for (let i = 0; i < 400; i++) {
    const processed = service.worker.drain();
    yield snap();
    if (service.worker.openCount() === 0) return;
    if (processed === 0) {
      const next = service.worker.nextDue();
      if (next === null) return;
      service.clock.set(next);
    }
  }
}
